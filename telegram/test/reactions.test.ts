// Telegram only accepts reactions from a fixed list. 📥 was never on it, and the failed call is
// swallowed, so an unlistened message got no feedback at all. Every emoji the code uses must be
// on the list (copied from the Bot API page, ReactionTypeEmoji, checked 2026-10-22).

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupHarness, sleep, waitForSocketAt, daemonSocketPath } from "./support/harness.ts";
import { ALLOWED_REACTIONS, REACTION_DELIVERED, REACTION_QUEUED, REACTION_HANDED_OFF } from "../src/transports/telegram/reactions.ts";

test("the allowed-reaction list has the 73 emoji Telegram documents", () => {
  assert.equal(ALLOWED_REACTIONS.size, 73);
  assert.ok(ALLOWED_REACTIONS.has("👀"));
  assert.ok(!ALLOWED_REACTIONS.has("📥"));
});

test("every reaction the code uses is allowed", () => {
  for (const emoji of [REACTION_DELIVERED, REACTION_QUEUED, REACTION_HANDED_OFF]) {
    assert.ok(ALLOWED_REACTIONS.has(emoji), `${emoji} is not an allowed Telegram reaction`);
  }
});

test("a message with nobody listening is marked queued with an allowed emoji", async () => {
  const h = await setupHarness();
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    h.fake.pushMessage({ chatId: Number(h.chatId), userId: Number(h.userId), text: "queue me" });
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline && !h.fake.sent.some((m) => m.method === "setMessageReaction")) await sleep(30);
    const reaction = h.fake.sent.find((m) => m.method === "setMessageReaction");
    assert.ok(reaction, "a reaction must be set");
    const emoji = (reaction.body.reaction as Array<{ emoji: string }>)[0]!.emoji;
    assert.equal(emoji, REACTION_QUEUED);
    assert.ok(ALLOWED_REACTIONS.has(emoji));
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});
