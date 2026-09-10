// End-to-end tests: real daemon + real CLI subprocesses talking over the unix socket,
// against a FakeTelegram HTTP server standing in for api.telegram.org.

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupHarness, sleep, waitForSocketAt, daemonSocketPath } from "./support/harness.ts";
import type { SentMessage } from "./support/fake-telegram.ts";

function extractShortId(msg: SentMessage | undefined, action: string): string | undefined {
  const markup = msg?.body.reply_markup as { inline_keyboard?: Array<Array<{ callback_data?: string }>> } | undefined;
  for (const row of markup?.inline_keyboard ?? []) {
    for (const button of row) {
      if (!button.callback_data) continue;
      const parts = button.callback_data.split(":");
      if (parts[0] === "q" && parts[2] === action) return parts[1];
    }
  }
  return undefined;
}

async function waitUntil(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(30);
  }
  throw new Error("condition not met in time");
}

test("tg send delivers a message with the level prefix and hostname", async () => {
  const h = await setupHarness({ hostname: "REDD-mason" });
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    const result = await h.runCli(["send", "--level", "success", "--title", "Done", "All good"]);
    assert.equal(result.code, 0, result.stderr);
    await waitUntil(() => h.fake.sent.some((m) => m.method === "sendMessage"));
    const sent = h.fake.sent.find((m) => m.method === "sendMessage")!;
    assert.equal(sent.body.chat_id, h.chatId);
    const text = String(sent.body.text);
    assert.match(text, /✅/);
    assert.match(text, /REDD-mason/);
    assert.match(text, /Done/);
    assert.match(text, /All good/);
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("tg ask single-choice: tap submits and stdout carries the ask-questions result shape", async () => {
  const h = await setupHarness();
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));

    const payload = {
      version: 1,
      questions: [{ id: "color", prompt: "Pick a color", type: "single", options: [{ value: "red", label: "Red" }, { value: "blue", label: "Blue" }] }],
    };
    const askProc = h.spawnCli(["ask", "--json", JSON.stringify(payload)]);
    let stdout = "";
    askProc.stdout!.on("data", (c) => (stdout += c.toString()));

    await waitUntil(() => h.fake.sent.some((m) => m.method === "sendMessage" && extractShortId(m, "s") !== undefined));
    const questionMsg = h.fake.sent.find((m) => m.method === "sendMessage" && extractShortId(m, "s") !== undefined)!;
    const shortId = extractShortId(questionMsg, "s")!;

    h.fake.pushCallback({ chatId: Number(h.chatId), userId: Number(h.userId), data: `q:${shortId}:s:1` });

    const exitInfo = await new Promise<number | null>((resolve) => askProc.once("close", resolve));
    assert.equal(exitInfo, 0);
    const result = JSON.parse(stdout.trim().split("\n").pop()!);
    assert.equal(result.version, 1);
    assert.equal(result.status, "submitted");
    assert.equal(result.answers.color.value, "blue");
    assert.equal(result.answers.color.notes, "");
    assert.ok(result.askerPath);

    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("unauthorized user's callback is dropped and does not resolve the question", async () => {
  const h = await setupHarness();
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));

    const payload = {
      version: 1,
      questions: [{ id: "q1", prompt: "Pick one", type: "single", options: [{ value: "a", label: "A" }] }],
    };
    const askProc = h.spawnCli(["ask", "--json", JSON.stringify(payload)]);
    let stdout = "";
    let closed = false;
    askProc.stdout!.on("data", (c) => (stdout += c.toString()));
    askProc.once("close", () => (closed = true));

    await waitUntil(() => h.fake.sent.some((m) => m.method === "sendMessage" && extractShortId(m, "s") !== undefined));
    const questionMsg = h.fake.sent.find((m) => m.method === "sendMessage" && extractShortId(m, "s") !== undefined)!;
    const shortId = extractShortId(questionMsg, "s")!;

    // A stranger's chat/user, not the allowed identity.
    h.fake.pushCallback({ chatId: 9999, userId: 8888, data: `q:${shortId}:s:0` });
    await sleep(400);
    assert.equal(closed, false, "the batch must not resolve from an unauthorized update");

    // Now the real allowed user answers, and it should go through normally.
    h.fake.pushCallback({ chatId: Number(h.chatId), userId: Number(h.userId), data: `q:${shortId}:s:0` });
    const exitInfo = await new Promise<number | null>((resolve) => askProc.once("close", resolve));
    assert.equal(exitInfo, 0);
    const result = JSON.parse(stdout.trim().split("\n").pop()!);
    assert.equal(result.status, "submitted");

    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("a stale callback for an already-resolved question is answered but harmless", async () => {
  const h = await setupHarness();
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));

    const payload = {
      version: 1,
      questions: [{ id: "q1", prompt: "Pick one", type: "single", options: [{ value: "a", label: "A" }] }],
    };
    const askProc = h.spawnCli(["ask", "--json", JSON.stringify(payload)]);
    let stdout = "";
    askProc.stdout!.on("data", (c) => (stdout += c.toString()));

    await waitUntil(() => h.fake.sent.some((m) => m.method === "sendMessage" && extractShortId(m, "s") !== undefined));
    const questionMsg = h.fake.sent.find((m) => m.method === "sendMessage" && extractShortId(m, "s") !== undefined)!;
    const shortId = extractShortId(questionMsg, "s")!;

    h.fake.pushCallback({ chatId: Number(h.chatId), userId: Number(h.userId), data: `q:${shortId}:s:0` });
    await new Promise<number | null>((resolve) => askProc.once("close", resolve));

    const answerCountBefore = h.fake.sent.filter((m) => m.method === "answerCallbackQuery").length;
    // Tap the same (now resolved) button again.
    h.fake.pushCallback({ chatId: Number(h.chatId), userId: Number(h.userId), data: `q:${shortId}:s:0` });
    await waitUntil(() => h.fake.sent.filter((m) => m.method === "answerCallbackQuery").length > answerCountBefore);
    const lastAnswer = h.fake.sent.filter((m) => m.method === "answerCallbackQuery").pop()!;
    assert.match(String(lastAnswer.body.text ?? ""), /already resolved/i);

    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("CLI disconnect cancels the pending question on Telegram", async () => {
  const h = await setupHarness();
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));

    const payload = {
      version: 1,
      questions: [{ id: "q1", prompt: "Pick one", type: "single", options: [{ value: "a", label: "A" }] }],
    };
    const askProc = h.spawnCli(["ask", "--json", JSON.stringify(payload)]);
    await waitUntil(() => h.fake.sent.some((m) => m.method === "sendMessage" && extractShortId(m, "s") !== undefined));

    askProc.kill("SIGKILL"); // hard kill: no SIGINT handling, just a dead socket

    await waitUntil(() => h.fake.sent.some((m) => m.method === "editMessageText" && String(m.body.text ?? "").includes("cancelled")));

    const status = await h.runCli(["status"]);
    assert.match(status.stdout, /pending questions: 0/);

    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("daemon restart resumes a pending question and the CLI can re-attach with tg wait", async () => {
  const h = await setupHarness();
  try {
    const daemon1 = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));

    const payload = {
      version: 1,
      questions: [{ id: "q1", prompt: "Pick one", type: "single", options: [{ value: "a", label: "A" }] }],
    };
    const askProc = h.spawnCli(["ask", "--json", JSON.stringify(payload)]);
    let askStderr = "";
    askProc.stderr!.on("data", (c) => (askStderr += c.toString()));

    await waitUntil(() => h.fake.sent.some((m) => m.method === "sendMessage" && extractShortId(m, "s") !== undefined));
    await waitUntil(() => /Question id: /.test(askStderr));
    const batchId = /Question id: (\S+)/.exec(askStderr)![1]!;

    const questionMsg = h.fake.sent.find((m) => m.method === "sendMessage" && extractShortId(m, "s") !== undefined)!;
    const shortId = extractShortId(questionMsg, "s")!;

    daemon1.kill("SIGTERM");
    await sleep(300);
    askProc.kill("SIGKILL"); // the original CLI's connection is gone regardless

    const daemon2 = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    await sleep(200);

    h.fake.pushCallback({ chatId: Number(h.chatId), userId: Number(h.userId), data: `q:${shortId}:s:0` });

    const waitResult = await h.runCli(["wait", batchId]);
    assert.equal(waitResult.code, 0, waitResult.stderr);
    const result = JSON.parse(waitResult.stdout.trim());
    assert.equal(result.status, "submitted");
    assert.equal(result.answers.q1.value, "a");

    daemon2.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("tg setup discovers the chat id from getUpdates", async () => {
  const h = await setupHarness();
  try {
    // setup writes into AGENT_TELEGRAM_HOME/config, so start from a clean config dir.
    const setupPromise = h.runCli(["setup", "--token", "999:setup-token-abcdefghijklmnopqrstuvwx"]);
    await waitUntil(() => true, 50).catch(() => {});
    // Give the discovery loop a moment to start polling, then simulate Reid's first message.
    await sleep(300);
    h.fake.pushMessage({ chatId: 5555, userId: 6666, text: "hello bot" });
    const result = await setupPromise;
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stderr, /Discovered chat 5555, user 6666/);
  } finally {
    await h.teardown();
  }
});
