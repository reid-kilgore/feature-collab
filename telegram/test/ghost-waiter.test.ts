// A `tg recv --wait` whose client died must not consume the next message (the message
// would be written to a closed socket and lost), and must stop counting as listening.

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupHarness, sleep, waitForSocketAt, daemonSocketPath } from "./support/harness.ts";

async function waitUntil(predicate: () => boolean | Promise<boolean>, timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(30);
  }
  throw new Error("condition not met in time");
}

test("a killed recv --wait leaves the next message unread for the next listener", async () => {
  const h = await setupHarness();
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));

    const recv = h.spawnCli(["recv", "--wait", "--timeout", "30s", "--channel", "ghost"]);
    // Kill it only once the daemon counts it as listening: killing earlier proves nothing.
    await waitUntil(async () => /listening: true/.test((await h.runCli(["status"])).stdout));
    recv.kill("SIGKILL");
    await waitUntil(async () => !/listening: true/.test((await h.runCli(["status"])).stdout));

    h.fake.pushMessage({ chatId: Number(h.chatId), userId: Number(h.userId), text: "do not lose me" });
    await waitUntil(() => h.fake.sent.some((m) => m.method === "setMessageReaction"));

    const peek = await h.runCli(["recv", "--peek", "--channel", "ghost"]);
    const parsed = JSON.parse(peek.stdout.trim());
    // Unrouted (channel NULL) rows are visible to every channel, so this reads the same row.
    assert.equal(parsed.messages.length, 1, "the message must still be unread");
    assert.equal(parsed.messages[0].text, "do not lose me");

    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("after the listener dies the daemon no longer reports it as listening", async () => {
  const h = await setupHarness();
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));

    const recv = h.spawnCli(["recv", "--wait", "--timeout", "30s", "--channel", "ghost"]);
    await waitUntil(async () => /listening: true/.test((await h.runCli(["status"])).stdout));

    recv.kill("SIGKILL");
    await waitUntil(async () => !/listening: true/.test((await h.runCli(["status"])).stdout));

    // No false 👀 for a message that arrives with nobody listening.
    h.fake.pushMessage({ chatId: Number(h.chatId), userId: Number(h.userId), text: "anyone?" });
    await waitUntil(() => h.fake.sent.some((m) => m.method === "setMessageReaction"));
    const reaction = h.fake.sent.find((m) => m.method === "setMessageReaction")!;
    assert.notEqual((reaction.body.reaction as Array<{ emoji: string }>)[0]!.emoji, "👀");

    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("a live recv --wait still receives and consumes", async () => {
  const h = await setupHarness();
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    const recv = h.spawnCli(["recv", "--wait", "--timeout", "10s", "--channel", "live"]);
    let out = "";
    recv.stdout!.on("data", (c) => (out += c.toString()));
    await waitUntil(async () => /listening: true/.test((await h.runCli(["status"])).stdout));
    h.fake.pushMessage({ chatId: Number(h.chatId), userId: Number(h.userId), text: "hello live" });
    await new Promise((r) => recv.once("close", r));
    assert.equal(JSON.parse(out.trim()).messages[0].text, "hello live");
    const again = await h.runCli(["recv", "--channel", "live"]);
    assert.equal(JSON.parse(again.stdout.trim()).messages.length, 0, "consumed exactly once");
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});
