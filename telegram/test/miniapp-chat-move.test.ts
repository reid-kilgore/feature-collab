// "Open in chat": a question has exactly one live copy after it is moved, the old copy is dead,
// and the rest of the chat flow carries on.

import { test } from "node:test";
import assert from "node:assert/strict";
import { startBatch, applyAnswerSingle, applyAnswerText, applyToggleMultiple, cancelBatch, requestOther } from "../src/core/interaction.ts";
import { openInChat } from "../src/core/chat-move.ts";
import type { AskResult } from "../src/contract/payload.ts";
import { createBatch, makeFakePort, makeStore, THREE_QUESTIONS } from "./support/miniapp.ts";

function rig() {
  const store = makeStore();
  const port = makeFakePort();
  const results: AskResult[] = [];
  const onResolved = (_id: string, result: AskResult) => results.push(result);
  const batchId = createBatch(store, THREE_QUESTIONS);
  const row = (idx: number) => store.listQuestionsForBatch(batchId)[idx]!;
  return { store, port, results, onResolved, batchId, row };
}

test("the whole set reposts the live question as a reply to its original and kills the old copy", async () => {
  const t = rig();
  await startBatch(t.store, t.port, t.batchId);
  const original = t.row(0).message_id!;
  const out = await openInChat(t.store, t.port, t.onResolved, t.batchId);
  assert.deepEqual(out, { status: "ok", moved: 1 });
  // One new send, a reply to the original; the old copy is edited to "moved".
  assert.equal(t.port.sends.length, 2);
  assert.equal(t.port.sends[1]!.index, 0);
  assert.equal(t.port.sends[1]!.replyTo, original);
  assert.deepEqual(t.port.moved, [{ oldMessageId: original, oldForceReplyMessageId: null }]);
  // The row points at the new message, and the old one is recorded as moved.
  assert.notEqual(t.row(0).message_id, original);
  assert.equal(t.row(0).message_id, t.port.sends[1]!.messageId);
  assert.equal(t.row(0).status, "pending");
  assert.equal(t.store.isMovedMessage(t.row(0).id, original), true);
  assert.equal(t.store.isMovedMessage(t.row(0).id, t.row(0).message_id!), false);
  // The rest of the set is untouched and follows as before.
  assert.equal(t.row(1).status, "waiting");
  await applyAnswerSingle(t.store, t.port, t.onResolved, t.row(0).id, "pg");
  assert.equal(t.row(1).status, "pending");
});

test("a multiple-choice question keeps the options already ticked when it moves", async () => {
  const t = rig();
  await startBatch(t.store, t.port, t.batchId);
  await applyAnswerSingle(t.store, t.port, t.onResolved, t.row(0).id, "pg");
  await applyToggleMultiple(t.store, t.row(1).id, "eu");
  const seen: string[][] = [];
  const original = t.port.sendQuestion;
  t.port.sendQuestion = async (...args) => {
    seen.push(args[5]);
    return original(...args);
  };
  const out = await openInChat(t.store, t.port, t.onResolved, t.batchId);
  assert.equal(out.status, "ok");
  assert.deepEqual(seen, [["eu"]]);
  assert.deepEqual(JSON.parse(t.row(1).selected_json!), ["eu"]);
});

test("a text question moves with a fresh reply prompt, and the old prompt is removed", async () => {
  const t = rig();
  await startBatch(t.store, t.port, t.batchId);
  await applyAnswerSingle(t.store, t.port, t.onResolved, t.row(0).id, "pg");
  // Show q3 now (out of order, while q2 is live), then move that live copy.
  await openInChat(t.store, t.port, t.onResolved, t.batchId, "q3");
  const before = t.row(2);
  const oldForce = before.force_reply_message_id;
  const out = await openInChat(t.store, t.port, t.onResolved, t.batchId, "q3");
  assert.equal(out.status, "ok");
  const after = t.row(2);
  assert.equal(after.status, "awaiting_text");
  assert.notEqual(after.force_reply_message_id, oldForce);
  assert.equal(t.port.moved.at(-1)!.oldForceReplyMessageId, oldForce);
  assert.equal(t.store.isMovedMessage(after.id, before.message_id!), true);
  // A reply to the NEW prompt answers it.
  await applyAnswerText(t.store, t.port, t.onResolved, after.id, "done");
  assert.equal(t.row(2).status, "answered");
});

test("a choice question whose Other prompt was open starts again from its buttons", async () => {
  const t = rig();
  await startBatch(t.store, t.port, t.batchId);
  await requestOther(t.store, t.port, t.row(0).id);
  t.store.updateQuestion(t.row(0).id, { force_reply_message_id: 777 });
  const out = await openInChat(t.store, t.port, t.onResolved, t.batchId);
  assert.equal(out.status, "ok");
  assert.equal(t.row(0).status, "pending");
  assert.equal(t.row(0).force_reply_message_id, null);
  assert.equal(t.port.moved[0]!.oldForceReplyMessageId, 777);
});

test("one question not yet shown is sent now, and the questions before it still follow", async () => {
  const t = rig();
  await startBatch(t.store, t.port, t.batchId);
  const out = await openInChat(t.store, t.port, t.onResolved, t.batchId, "q3");
  assert.deepEqual(out, { status: "ok", moved: 1 });
  assert.equal(t.row(2).status, "awaiting_text");
  assert.notEqual(t.row(2).message_id, null);
  assert.equal(t.port.sends.at(-1)!.replyTo, undefined);
  // Answering q1 must still bring up q2, even though q3 is live further down.
  await applyAnswerSingle(t.store, t.port, t.onResolved, t.row(0).id, "pg");
  assert.equal(t.row(1).status, "pending");
  assert.notEqual(t.row(1).message_id, null);
});

test("a question answered while the new message is being sent is a conflict and the new message is retracted", async () => {
  const t = rig();
  await startBatch(t.store, t.port, t.batchId);
  t.port.duringSend = async () => {
    t.port.duringSend = undefined;
    await applyAnswerSingle(t.store, t.port, t.onResolved, t.row(0).id, "sqlite");
  };
  const out = await openInChat(t.store, t.port, t.onResolved, t.batchId, "q1");
  assert.equal(out.status, "conflict");
  assert.match(out.reason!, /Already answered/);
  assert.equal(t.port.retracted.length, 1);
  assert.deepEqual(JSON.parse(t.row(0).selected_json!), ["sqlite"]);
  assert.equal(t.port.moved.length, 0);
});

test("a resolved question, an unknown question, a cancelled batch and a late batch are refused", async () => {
  const t = rig();
  await startBatch(t.store, t.port, t.batchId);
  await applyAnswerSingle(t.store, t.port, t.onResolved, t.row(0).id, "pg");
  assert.equal((await openInChat(t.store, t.port, t.onResolved, t.batchId, "q1")).status, "conflict");
  assert.equal((await openInChat(t.store, t.port, t.onResolved, t.batchId, "nope")).status, "invalid");
  assert.equal((await openInChat(t.store, t.port, t.onResolved, "missing")).status, "unknown");
  await cancelBatch(t.store, t.port, t.onResolved, t.batchId);
  const cancelled = await openInChat(t.store, t.port, t.onResolved, t.batchId);
  assert.equal(cancelled.status, "conflict");
  assert.match(cancelled.reason!, /cancelled/);

  const late = rig();
  await startBatch(late.store, late.port, late.batchId);
  late.store.db.prepare("UPDATE batches SET timeout_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), late.batchId);
  assert.equal((await openInChat(late.store, late.port, late.onResolved, late.batchId)).status, "conflict");
  assert.equal(late.port.sends.length, 1);
});

test("two moves at once leave exactly one live copy", async () => {
  const t = rig();
  await startBatch(t.store, t.port, t.batchId);
  const original = t.row(0).message_id!;
  const [a, b] = await Promise.all([openInChat(t.store, t.port, t.onResolved, t.batchId), openInChat(t.store, t.port, t.onResolved, t.batchId)]);
  assert.equal(a.status, "ok");
  assert.equal(b.status, "ok");
  // Each move retires the copy it replaced; only the last copy is live.
  assert.equal(t.store.isMovedMessage(t.row(0).id, original), true);
  assert.equal(t.store.isMovedMessage(t.row(0).id, t.row(0).message_id!), false);
  assert.equal(t.port.moved.length, 2);
});

test("a question opened early finishes the batch last: answer 1, then 2, then 3", async () => {
  const t = rig();
  await startBatch(t.store, t.port, t.batchId);
  await openInChat(t.store, t.port, t.onResolved, t.batchId, "q3");
  await applyAnswerSingle(t.store, t.port, t.onResolved, t.row(0).id, "pg");
  assert.equal(t.row(1).status, "pending");
  assert.equal(t.results.length, 0);
  const { applyContinueMultiple } = await import("../src/core/interaction.ts");
  await applyToggleMultiple(t.store, t.row(1).id, "us");
  await applyContinueMultiple(t.store, t.port, t.onResolved, t.row(1).id);
  // q1 and q2 are done but q3 is still live: the batch must not finish.
  assert.equal(t.results.length, 0);
  assert.equal(t.store.getBatch(t.batchId)!.status, "pending");
  await applyAnswerText(t.store, t.port, t.onResolved, t.row(2).id, "last");
  assert.equal(t.results.length, 1);
  assert.equal(t.results[0]!.status, "submitted");
  assert.deepEqual(t.results[0]!.answers.q3, { value: "last", notes: "" });
});

test("a move or submit that overlaps the chat flow's own send leaves one live copy", async () => {
  const t = rig();
  await startBatch(t.store, t.port, t.batchId);
  // While the chat flow is sending q2 after q1 is answered, a move of q2 runs in the middle.
  let triggered = false;
  t.port.duringSend = async () => {
    if (triggered) return;
    triggered = true;
    await openInChat(t.store, t.port, t.onResolved, t.batchId, "q2");
  };
  await applyAnswerSingle(t.store, t.port, t.onResolved, t.row(0).id, "pg");
  const q2Sends = t.port.sends.filter((s) => s.index === 1);
  assert.equal(q2Sends.length, 2, "both senders sent");
  // The row points at exactly one of them; the other was retracted.
  const kept = t.row(1).message_id!;
  const dropped = q2Sends.map((s) => s.messageId).filter((id) => id !== kept);
  assert.equal(dropped.length, 1);
  assert.deepEqual(t.port.retracted, dropped);
  assert.equal(t.row(1).status, "pending");
});

test("the move and its audit record are written together or not at all", () => {
  const store = makeStore();
  assert.throws(() =>
    store.inTransaction(() => {
      store.appendAudit("question_moved", "b", "q", { from: 1, to: 2, fromForce: 3 });
      throw new Error("boom");
    }),
  );
  assert.equal(store.isMovedMessage("q", 1), false);
  assert.equal(store.questionForMovedForceReply(3), undefined);
  store.inTransaction(() => store.appendAudit("question_moved", "b", "q", { from: 1, to: 2, fromForce: 3 }));
  assert.equal(store.isMovedMessage("q", 1), true);
  assert.equal(store.questionForMovedForceReply(3), "q");
});

test("startup recovery sends the questions skipped over by an early move", async () => {
  const { recoverOnStartup } = await import("../src/daemon/server.ts");
  const t = rig();
  await startBatch(t.store, t.port, t.batchId);
  await openInChat(t.store, t.port, t.onResolved, t.batchId, "q3");
  await applyAnswerSingle(t.store, t.port, t.onResolved, t.row(0).id, "pg");
  // Simulate the crash: q2's chat message never made it out.
  t.store.updateQuestion(t.row(1).id, { status: "waiting", message_id: null });
  const before = t.port.sends.length;
  await recoverOnStartup(t.store, t.port as never, t.onResolved, () => {});
  assert.equal(t.row(1).status, "pending");
  assert.notEqual(t.row(1).message_id, null);
  assert.equal(t.port.sends.length, before + 1);
  assert.equal(t.port.sends.at(-1)!.index, 1);
});
