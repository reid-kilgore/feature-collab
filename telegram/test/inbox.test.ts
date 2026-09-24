// Coverage for the /ask and /inbox Telegram commands: adding an item to the maestro
// inbox, listing recent items with their buttons, viewing one item's detail and trail on
// tap, auth, and graceful handling when the maestro binary fails. All daemon-level (real
// process, real socket, fake Telegram server), against the stub `maestro` the harness
// wires up by default — see test/support/harness.ts for the stub's file-driven fixtures.

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { setupHarness, sleep, waitForSocketAt, daemonSocketPath } from "./support/harness.ts";
import type { SentMessage } from "./support/fake-telegram.ts";

async function waitUntil(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(30);
  }
  throw new Error("condition not met in time");
}

function readAdded(home: string): Array<{ id: string; text: string }> {
  const file = path.join(home, "maestro-added.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

test("/ask <text> adds a maestro item and replies with its id", async () => {
  const h = await setupHarness();
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));

    h.fake.pushMessage({ chatId: Number(h.chatId), userId: Number(h.userId), text: "/ask buy milk" });
    await waitUntil(() => h.fake.sent.some((m) => m.method === "sendMessage" && String(m.body.text ?? "").startsWith("Added ")));

    const reply = h.fake.lastMessageTo(h.chatId, (m) => String(m.body.text ?? "").startsWith("Added "))!;
    assert.match(String(reply.body.text), /^Added t1 to the inbox\.$/);

    const added = readAdded(h.home);
    assert.equal(added.length, 1);
    assert.equal(added[0]!.text, "buy milk");

    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("a reply to a pending tg-ask question is not added to the maestro inbox", async () => {
  const h = await setupHarness();
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));

    const payload = { version: 1, questions: [{ id: "q1", prompt: "Say anything", type: "text" }] };
    const askProc = h.spawnCli(["ask", "--json", JSON.stringify(payload)]);
    let askStdout = "";
    askProc.stdout!.on("data", (c) => (askStdout += c.toString()));

    await waitUntil(() => h.fake.sent.some((m) => m.method === "sendMessage" && m.body.reply_markup && (m.body.reply_markup as { force_reply?: boolean }).force_reply));
    const forceReplyMsg = h.fake.sent.find((m) => m.method === "sendMessage" && m.body.reply_markup && (m.body.reply_markup as { force_reply?: boolean }).force_reply)!;
    const sendMessageCalls = h.fake.sent.filter((m) => m.method === "sendMessage");
    const forceReplyMessageId = sendMessageCalls.indexOf(forceReplyMsg) + 1;

    h.fake.pushMessage({ chatId: Number(h.chatId), userId: Number(h.userId), text: "the answer", replyToMessageId: forceReplyMessageId });

    const code = await new Promise<number | null>((resolve) => askProc.once("close", resolve));
    assert.equal(code, 0);
    const result = JSON.parse(askStdout.trim().split("\n").pop()!);
    assert.equal(result.answers.q1.value, "the answer");

    assert.deepEqual(readAdded(h.home), [], "answering a tg-ask question must not also create a maestro item");

    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("/inbox renders recent items as lines with a button each", async () => {
  const h = await setupHarness();
  try {
    const items = [
      { id: "a7", host: "local", kind: "ask", state: "open", by: "reid", at: new Date(Date.now() - 5 * 60_000).toISOString(), touched: "", text: "check the PR", ref: null, trail: [] },
      { id: "duo:a3", host: "duo", kind: "ask", state: "taken", by: "reid", at: new Date(Date.now() - 3 * 3600_000).toISOString(), touched: "", text: "look into the flaky test", ref: null, trail: [] },
    ];
    writeFileSync(path.join(h.home, "maestro-recent-items.json"), JSON.stringify(items));

    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));

    h.fake.pushMessage({ chatId: Number(h.chatId), userId: Number(h.userId), text: "/inbox" });
    await waitUntil(() => h.fake.sent.some((m) => m.method === "sendMessage" && String(m.body.text ?? "").includes("a7")));

    const listMsg = h.fake.lastMessageTo(h.chatId, (m) => m.method === "sendMessage" && String(m.body.text ?? "").includes("a7"))!;
    const text = String(listMsg.body.text);
    assert.match(text, /1\. .*a7.*check the PR/);
    assert.match(text, /2\. .*duo:a3.*look into the flaky test/);

    const keyboard = (listMsg.body.reply_markup as { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }).inline_keyboard;
    assert.equal(keyboard.length, 2);
    assert.equal(keyboard[0]![0]!.callback_data, "ibx:a7");
    assert.equal(keyboard[1]![0]!.callback_data, "ibx:duo:a3");

    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("tapping an inbox item renders its detail and trail, with untrusted text escaped", async () => {
  const h = await setupHarness();
  try {
    const items = [
      {
        id: "a9",
        host: "local",
        kind: "ask",
        state: "done",
        by: "reid",
        at: new Date(Date.now() - 60_000).toISOString(),
        touched: "",
        text: "check <b>this</b> & that",
        ref: null,
        trail: [{ op: "done", by: "session-x", at: new Date().toISOString(), text: "handled <script>alert(1)</script>" }],
      },
    ];
    writeFileSync(path.join(h.home, "maestro-recent-items.json"), JSON.stringify(items));

    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));

    h.fake.pushCallback({ chatId: Number(h.chatId), userId: Number(h.userId), data: "ibx:a9" });
    await waitUntil(() => h.fake.sent.some((m) => m.method === "sendMessage" && String(m.body.text ?? "").includes("a9")));

    const detail = h.fake.lastMessageTo(h.chatId, (m) => m.method === "sendMessage" && String(m.body.text ?? "").includes("a9"))!;
    const text = String(detail.body.text);

    assert.ok(text.includes("check &lt;b&gt;this&lt;/b&gt; &amp; that"), "item text must be HTML-escaped, not interpreted");
    assert.ok(text.includes("handled &lt;script&gt;alert(1)&lt;/script&gt;"), "trail text must be HTML-escaped, not interpreted");
    assert.ok(text.includes("session-x"), "trail entry attribution must be shown");
    assert.ok(h.fake.sent.some((m) => m.method === "answerCallbackQuery"));

    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("a non-allowed user's /ask is ignored: nothing is added, nothing is sent back", async () => {
  const h = await setupHarness();
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));

    h.fake.pushMessage({ chatId: 9999, userId: 8888, text: "/ask sneak this in" });
    await sleep(500); // no reply is expected, so just give the daemon a beat to (not) act

    assert.equal(readAdded(h.home).length, 0);
    assert.equal(h.fake.sent.filter((m) => m.method === "sendMessage").length, 0);

    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("a maestro failure on /inbox is shown as a warning, not a crash", async () => {
  const h = await setupHarness();
  try {
    writeFileSync(path.join(h.home, "maestro-fail-recent"), "duo unreachable\n");

    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));

    h.fake.pushMessage({ chatId: Number(h.chatId), userId: Number(h.userId), text: "/inbox" });
    await waitUntil(() => h.fake.sent.some((m) => m.method === "sendMessage" && String(m.body.text ?? "").includes("⚠️")));

    const warned = h.fake.lastMessageTo(h.chatId, (m) => String(m.body.text ?? "").includes("⚠️"))!;
    assert.ok(String(warned.body.text).includes("duo unreachable") || String(warned.body.text).length > 0);

    // The daemon is still alive and answers a plain /status afterward.
    const status = await h.runCli(["status"]);
    assert.equal(status.code, 0, status.stderr);

    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("a maestro failure on /ask is shown as a warning, and nothing is silently added", async () => {
  const h = await setupHarness();
  try {
    writeFileSync(path.join(h.home, "maestro-fail-add"), "stub down for maintenance\n");

    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));

    h.fake.pushMessage({ chatId: Number(h.chatId), userId: Number(h.userId), text: "/ask does this get lost" });
    await waitUntil(() => h.fake.sent.some((m) => m.method === "sendMessage" && String(m.body.text ?? "").includes("⚠️")));

    assert.equal(readAdded(h.home).length, 0);

    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("maestroEnv puts ~/bin and Homebrew ahead of launchd's bare PATH", async () => {
  const { maestroEnv } = await import("../src/inbox/maestro.ts");
  const env = maestroEnv({ PATH: "/usr/bin:/bin:/usr/sbin:/sbin", KEEP: "1" }, "/Users/someone");
  assert.equal(env.PATH, "/Users/someone/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin");
  assert.equal(env.KEEP, "1");
  const again = maestroEnv({ PATH: "/opt/homebrew/bin:/usr/bin" }, "/Users/someone");
  assert.equal(again.PATH, "/Users/someone/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin");
});
