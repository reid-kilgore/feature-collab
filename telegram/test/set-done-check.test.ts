// An answered askd set puts a check mark on its intro message (title and link) instead of sending a
// separate "Answers sent" message. Plain `tg ask` batches keep the separate message. Fake Telegram only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeTelegram } from "./support/fake-telegram.ts";
import { TelegramApi } from "../src/transports/telegram/api.ts";
import { createTelegramPort } from "../src/transports/telegram/handler.ts";
import { renderHeaderDone } from "../src/transports/telegram/render.ts";
import { Store } from "../src/core/store.ts";
import type { BatchRow } from "../src/core/store.ts";
import type { AskPayload } from "../src/contract/payload.ts";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const payload: AskPayload = {
  version: 1,
  title: "Cash tips",
  message: "Full context on the [questions page](https://example.test/sets/812e/) or in the mini app.",
  questions: [{ id: "q", prompt: "p", type: "text" }],
};

function batchFor(askKey: string | null, headerId: number | null): BatchRow {
  return { chat_id: "1001", asker_path: "/x/proj", asker_tmux_window: null, asker_address: "ship:geo", ask_key: askKey, header_message_id: headerId, payload_json: JSON.stringify(payload) } as BatchRow;
}

async function withPort(fn: (port: ReturnType<typeof createTelegramPort>, fake: FakeTelegram) => Promise<void>): Promise<void> {
  const fake = new FakeTelegram();
  await fake.start();
  try {
    await fn(createTelegramPort(new TelegramApi("1:FAKE", fake.baseUrl)), fake);
  } finally {
    await fake.stop();
  }
}

test("renderHeaderDone puts a check mark in front of the intro text", () => {
  assert.equal(renderHeaderDone("📋 <b>Cash tips</b>"), "✅ 📋 <b>Cash tips</b>");
});

test("sendHeader returns the id of the intro message", async () => {
  await withPort(async (port, fake) => {
    const res = await port.sendHeader(batchFor("askd-1", null), payload);
    const sent = fake.sent.filter((m) => m.method === "sendMessage");
    assert.equal(sent.length, 1);
    assert.ok(res && typeof res.messageId === "number");
  });
});

test("an answered askd set edits its intro message with a check mark and sends no new message", async () => {
  await withPort(async (port, fake) => {
    await port.sendBatchDone(batchFor("askd-812e91e99b53", 77));
    assert.equal(fake.sent.filter((m) => m.method === "sendMessage").length, 0, "no separate done message");
    const edits = fake.sent.filter((m) => m.method === "editMessageText");
    assert.equal(edits.length, 1);
    assert.equal(edits[0]!.body.message_id, 77);
    assert.match(String(edits[0]!.body.text), /^✅ 📋 <b>Cash tips<\/b>\nFull context on the <a href="https:\/\/example.test\/sets\/812e\/">questions page<\/a>/);
    assert.ok(edits[0]!.body.reply_markup, "the link button is kept");
  });
});

test("an askd set with no stored intro message still gets the done message", async () => {
  await withPort(async (port, fake) => {
    await port.sendBatchDone(batchFor("askd-812e91e99b53", null));
    const sent = fake.sent.filter((m) => m.method === "sendMessage");
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.body.text, "✅ Answers sent to the agent");
  });
});

test("a plain tg ask batch keeps the separate done message", async () => {
  await withPort(async (port, fake) => {
    await port.sendBatchDone(batchFor("ask-both-1", 77));
    assert.equal(fake.sent.filter((m) => m.method === "editMessageText").length, 0);
    assert.equal(fake.sent.filter((m) => m.method === "sendMessage").length, 1);
  });
});

test("the store keeps the intro message id", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "agent-telegram-test-"));
  try {
    const store = new Store(path.join(dir, "state.sqlite"));
    store.createBatch({ id: "b", status: "pending", asker_path: "/y", asker_tmux_window: null, payload_json: "{}", timeout_at: null, on_timeout: null, chat_id: "1", user_id: "1" });
    assert.equal(store.getBatch("b")!.header_message_id, null);
    store.setBatchHeaderMessage("b", 55);
    assert.equal(store.getBatch("b")!.header_message_id, 55);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
