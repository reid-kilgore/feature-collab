// Minimal coverage for the inbox / `tg recv` feature, per the "Back-and-forth conversation"
// addendum to DESIGN.md: unsolicited text lands in the inbox, `--wait` unblocks on arrival,
// consume vs peek, and a reply to a question still routes to the question (not the inbox).

import { test } from "node:test";
import assert from "node:assert/strict";
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

test("unsolicited text from the allowed user lands in the inbox, not a hint reply", async () => {
  const h = await setupHarness();
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));

    h.fake.pushMessage({ chatId: Number(h.chatId), userId: Number(h.userId), text: "hey, how's it going" });
    await waitUntil(() => h.fake.sent.some((m) => m.method === "setMessageReaction"));

    const result = await h.runCli(["recv"]);
    assert.equal(result.code, 0, result.stderr);
    const parsed = JSON.parse(result.stdout.trim());
    assert.equal(parsed.status, "received");
    assert.equal(parsed.messages.length, 1);
    assert.equal(parsed.messages[0].text, "hey, how's it going");

    // No "I didn't understand that" hint should ever have been sent for plain conversation.
    assert.ok(!h.fake.sent.some((m: SentMessage) => String(m.body.text ?? "").includes("didn't understand")));

    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("tg recv --wait blocks until a message arrives, then returns it", async () => {
  const h = await setupHarness();
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));

    const recvProc = h.spawnCli(["recv", "--wait", "--timeout", "10s"]);
    let stdout = "";
    recvProc.stdout!.on("data", (c) => (stdout += c.toString()));

    // Give the daemon a moment to register the waiter before the message arrives.
    await sleep(300);
    h.fake.pushMessage({ chatId: Number(h.chatId), userId: Number(h.userId), text: "are you there" });

    const code = await new Promise<number | null>((resolve) => recvProc.once("close", resolve));
    assert.equal(code, 0);
    const parsed = JSON.parse(stdout.trim());
    assert.equal(parsed.status, "received");
    assert.equal(parsed.messages[0].text, "are you there");

    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("tg recv --peek does not consume, a plain tg recv afterward does", async () => {
  const h = await setupHarness();
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));

    h.fake.pushMessage({ chatId: Number(h.chatId), userId: Number(h.userId), text: "peek me" });
    await waitUntil(() => h.fake.sent.some((m) => m.method === "setMessageReaction"));

    const peeked = await h.runCli(["recv", "--peek"]);
    assert.equal(JSON.parse(peeked.stdout.trim()).messages.length, 1);

    const peekedAgain = await h.runCli(["recv", "--peek"]);
    assert.equal(JSON.parse(peekedAgain.stdout.trim()).messages.length, 1, "peek must not consume");

    const consumed = await h.runCli(["recv"]);
    assert.equal(JSON.parse(consumed.stdout.trim()).messages.length, 1);

    const empty = await h.runCli(["recv"]);
    assert.equal(JSON.parse(empty.stdout.trim()).messages.length, 0, "message must be gone after consuming recv");

    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("a text reply to a pending question still routes to the question, not the inbox", async () => {
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
    // The sent message doesn't carry its own message_id back in our fake, but every sendMessage
    // gets a sequential id starting at 1; recompute it from position among sendMessage calls.
    const sendMessageCalls = h.fake.sent.filter((m) => m.method === "sendMessage");
    const forceReplyIndex = sendMessageCalls.indexOf(forceReplyMsg);
    const forceReplyMessageId = forceReplyIndex + 1;

    h.fake.pushMessage({ chatId: Number(h.chatId), userId: Number(h.userId), text: "the answer", replyToMessageId: forceReplyMessageId });

    const code = await new Promise<number | null>((resolve) => askProc.once("close", resolve));
    assert.equal(code, 0);
    const result = JSON.parse(askStdout.trim().split("\n").pop()!);
    assert.equal(result.answers.q1.value, "the answer");

    const inbox = await h.runCli(["recv", "--peek"]);
    assert.equal(JSON.parse(inbox.stdout.trim()).messages.length, 0, "a routed question reply must not also land in the inbox");

    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});
