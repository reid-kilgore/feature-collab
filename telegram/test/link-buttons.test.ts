// URL buttons: tg send --button, the automatic button for a lone link, --no-button, the resend without buttons
// when Telegram refuses one, and the same automatic button on a tg ask header.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseButtonArg, singleLinkButton } from "../src/core/buttons.ts";
import { setupHarness, sleep, waitForSocketAt, daemonSocketPath } from "./support/harness.ts";
import type { Harness } from "./support/harness.ts";

async function until(f: () => boolean, ms = 20000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (f()) return;
    await sleep(30);
  }
  throw new Error("condition not met in time");
}

async function withDaemon(fn: (h: Harness) => Promise<void>): Promise<void> {
  const h = await setupHarness();
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    await fn(h);
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
}

// Sends and returns the one text message the fake saw.
async function sendText(h: Harness, args: string[]) {
  const before = h.fake.sent.length;
  const r = await h.runCli(["send", ...args]);
  assert.equal(r.code, 0, r.stderr);
  await until(() => h.fake.sent.length > before);
  return h.fake.sent[h.fake.sent.length - 1]!;
}

const keyboard = (m: { body: Record<string, unknown> }) => (m.body.reply_markup as { inline_keyboard: Array<Array<{ text: string; url: string }>> } | undefined)?.inline_keyboard;

test("parseButtonArg splits label and url at the first =http(s)://, and refuses anything else", () => {
  assert.deepEqual(parseButtonArg("Review=https://example.com/r?a=1"), { text: "Review", url: "https://example.com/r?a=1" });
  assert.deepEqual(parseButtonArg("a=b=http://example.com"), { text: "a=b", url: "http://example.com" });
  for (const bad of ["", "nolabel", "x=ftp://example.com", "=https://example.com", "x=javascript:alert(1)"]) assert.throws(() => parseButtonArg(bad), /--button needs/);
});

test("singleLinkButton: one link gives a button; two links, a non-http link, and a link in code give none", () => {
  assert.deepEqual(singleLinkButton("see [the review page](https://example.com/r/1) now"), { text: "the review page", url: "https://example.com/r/1" });
  assert.deepEqual(singleLinkButton("go to https://www.example.com/a?x=1&y=2."), { text: "Open example.com", url: "https://www.example.com/a?x=1&y=2" });
  assert.deepEqual(singleLinkButton("https://example.com/a and [again](https://example.com/a)")?.url, "https://example.com/a");
  assert.equal(singleLinkButton("https://example.com/a and https://example.com/b"), undefined);
  assert.equal(singleLinkButton("[x](ftp://example.com/a) and ftp://example.com/b"), undefined);
  assert.equal(singleLinkButton("run `curl https://example.com/a`"), undefined);
  assert.equal(singleLinkButton("no link here"), undefined);
});

test("tg send --button puts each button on its own row, and the text keeps the link", async () => {
  await withDaemon(async (h) => {
    const m = await sendText(h, ["--button", "One=https://example.com/1", "--button", "Two=https://example.com/2", "Two links https://example.com/1 here"]);
    assert.deepEqual(keyboard(m), [[{ text: "One", url: "https://example.com/1" }], [{ text: "Two", url: "https://example.com/2" }]]);
    assert.match(String(m.body.text), /<a href="https:\/\/example.com\/1">/);
  });
});

test("tg send: a message with one link gets it as a button, labelled from a Markdown link or the host", async () => {
  await withDaemon(async (h) => {
    const a = await sendText(h, ["Look at [the report](https://example.com/report)"]);
    assert.deepEqual(keyboard(a), [[{ text: "the report", url: "https://example.com/report" }]]);
    assert.match(String(a.body.text), /<a href="https:\/\/example.com\/report">the report<\/a>/);
    const b = await sendText(h, ["Open https://example.com/x now"]);
    assert.deepEqual(keyboard(b), [[{ text: "Open example.com", url: "https://example.com/x" }]]);
  });
});

test("tg send: two different links give no automatic button, and --no-button turns it off for one link", async () => {
  await withDaemon(async (h) => {
    const two = await sendText(h, ["https://example.com/a and https://example.com/b"]);
    assert.equal(keyboard(two), undefined);
    const off = await sendText(h, ["--no-button", "just https://example.com/a"]);
    assert.equal(keyboard(off), undefined);
  });
});

test("tg send: a non-http link is never a button, and --button refuses it", async () => {
  await withDaemon(async (h) => {
    const m = await sendText(h, ["see [files](ftp://example.com/a)"]);
    assert.equal(keyboard(m), undefined);
    const r = await h.runCli(["send", "--button", "Files=ftp://example.com/a", "hi"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /--button needs/);
  });
});

test("tg send: when Telegram refuses the button, the message is resent without buttons and the refusal is logged", async () => {
  await withDaemon(async (h) => {
    h.fake.refuseUrlButtons = true;
    const m = await sendText(h, ["Local page http://127.0.0.1:8080/r/1"]);
    assert.equal(h.fake.refused.length, 1);
    assert.equal(keyboard(m), undefined);
    assert.match(String(m.body.text), /127\.0\.0\.1:8080/);
    assert.equal(h.fake.sent.filter((s) => s.method === "sendMessage").length, 1);
    assert.match(readFileSync(`${h.home}/state/daemon.log`, "utf8").replace(/\\/g, "/"), /url button refused[^\n]*BUTTON_URL_INVALID/);
  });
});

test("tg ask: the header message gets the lone link as a button, and the question keeps its answer keyboard", async () => {
  await withDaemon(async (h) => {
    const payload = {
      version: 1,
      title: "Review",
      message: "Read [the review page](https://example.com/review/7) first.",
      questions: [{ id: "c", prompt: "Ship?", type: "single", options: [{ value: "y", label: "Yes" }] }],
    };
    h.spawnCli(["ask", "--from", "test:harness", "--json", JSON.stringify(payload)]);
    await until(() => h.fake.sent.filter((m) => m.method === "sendMessage").length >= 2);
    const [header, question] = h.fake.sent.filter((m) => m.method === "sendMessage");
    assert.deepEqual(keyboard(header!), [[{ text: "the review page", url: "https://example.com/review/7" }]]);
    const rows = keyboard(question!)!;
    assert.ok(rows.length > 0);
    assert.ok(rows.flat().every((b) => !b.url), "answer keyboard holds no url button");
  });
});
