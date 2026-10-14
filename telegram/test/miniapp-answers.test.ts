// Mini App submits through the core interaction functions: success, partial submits, and the
// conflict cases (answered in chat, cancelled, expired) that must leave the chat flow able to go on.

import { test } from "node:test";
import assert from "node:assert/strict";
import { startBatch, applyAnswerSingle, cancelBatch, expireBatch, requestOther } from "../src/core/interaction.ts";
import { applyBatchAnswers } from "../src/core/answers.ts";
import type { AskPayload, AskResult } from "../src/contract/payload.ts";
import { createBatch, makeFakePort, makeStore, THREE_QUESTIONS } from "./support/miniapp.ts";

function rig(payload: AskPayload = THREE_QUESTIONS, opts: { timeoutAt?: string } = {}) {
  const store = makeStore();
  const port = makeFakePort();
  const results: AskResult[] = [];
  const onResolved = (_id: string, result: AskResult) => results.push(result);
  const batchId = createBatch(store, payload, opts);
  const row = (idx: number) => store.listQuestionsForBatch(batchId)[idx]!;
  return { store, port, results, onResolved, batchId, row };
}

test("answering every question in one submit resolves the asker once", async () => {
  const t = rig();
  await startBatch(t.store, t.port, t.batchId);
  const out = await applyBatchAnswers(t.store, t.port, t.onResolved, t.batchId, [
    { questionId: "q1", selected: ["pg"] },
    { questionId: "q2", selected: ["us", "eu"] },
    { questionId: "q3", text: "ship it" },
  ]);
  assert.deepEqual(out.results.map((r) => r.status), ["ok", "ok", "ok"]);
  assert.equal(out.batchStatus, "submitted");
  assert.equal(t.results.length, 1);
  assert.deepEqual(t.results[0]!.answers, {
    q1: { value: "pg", notes: "" },
    q2: { value: ["us", "eu"], notes: "" },
    q3: { value: "ship it", notes: "" },
  });
  assert.equal(t.port.done, true);
  // Only the first question was ever sent to chat: the others were answered before their turn.
  assert.equal(t.port.sentQuestions, 1);
});

test("a partial submit answers some questions and the chat flow carries on with the rest", async () => {
  const t = rig();
  await startBatch(t.store, t.port, t.batchId);
  const out = await applyBatchAnswers(t.store, t.port, t.onResolved, t.batchId, [{ questionId: "q1", selected: ["sqlite"] }]);
  assert.deepEqual(out.results.map((r) => r.status), ["ok"]);
  assert.equal(out.batchStatus, "pending");
  assert.equal(t.results.length, 0);
  // q2 is now the live chat question, with a message to tap.
  assert.equal(t.row(1).status, "pending");
  assert.notEqual(t.row(1).message_id, null);
  assert.equal(t.row(2).status, "waiting");
  // And chat can finish the batch from here.
  await applyBatchAnswers(t.store, t.port, t.onResolved, t.batchId, [{ questionId: "q2", selected: ["ap"] }, { questionId: "q3", skip: true }]);
  assert.equal(t.results.length, 1);
  assert.equal(t.results[0]!.status, "submitted");
});

test("later questions answered while an earlier one is still live in chat do not finish the batch early", async () => {
  const t = rig();
  await startBatch(t.store, t.port, t.batchId);
  const out = await applyBatchAnswers(t.store, t.port, t.onResolved, t.batchId, [
    { questionId: "q2", selected: ["eu"] },
    { questionId: "q3", text: "later" },
  ]);
  assert.deepEqual(out.results.map((r) => r.status), ["ok", "ok"]);
  assert.equal(out.batchStatus, "pending");
  assert.equal(t.results.length, 0);
  assert.equal(t.row(0).status, "pending");
  // Answering q1 in chat now finishes the batch with the mini app answers included.
  await applyAnswerSingle(t.store, t.port, t.onResolved, t.row(0).id, "pg");
  assert.equal(t.results.length, 1);
  assert.deepEqual(t.results[0]!.answers.q2, { value: ["eu"], notes: "" });
});

test("a question already answered in chat is reported as a conflict, the rest still go through", async () => {
  const t = rig();
  await startBatch(t.store, t.port, t.batchId);
  await applyAnswerSingle(t.store, t.port, t.onResolved, t.row(0).id, "pg");
  const out = await applyBatchAnswers(t.store, t.port, t.onResolved, t.batchId, [
    { questionId: "q1", selected: ["sqlite"] },
    { questionId: "q2", selected: ["us"] },
  ]);
  assert.equal(out.results[0]!.status, "conflict");
  assert.match(out.results[0]!.reason!, /Already answered in chat/);
  assert.equal(out.results[1]!.status, "ok");
  // The chat answer stands.
  assert.deepEqual(JSON.parse(t.row(0).selected_json!), ["pg"]);
  // q3 is the live chat question.
  assert.equal(t.row(2).status, "awaiting_text");
});

test("a cancelled batch rejects the whole submit and changes nothing", async () => {
  const t = rig();
  await startBatch(t.store, t.port, t.batchId);
  await cancelBatch(t.store, t.port, t.onResolved, t.batchId);
  const out = await applyBatchAnswers(t.store, t.port, t.onResolved, t.batchId, [{ questionId: "q1", selected: ["pg"] }, { questionId: "q2", selected: ["us"] }]);
  assert.equal(out.batchStatus, "cancelled");
  assert.deepEqual(out.results.map((r) => r.status), ["conflict", "conflict"]);
  assert.match(out.results[0]!.reason!, /cancelled/);
  assert.equal(t.results.length, 1);
  assert.equal(t.results[0]!.status, "cancelled");
});

test("an expired batch, and a batch past its deadline the sweeper has not reached, reject the submit", async () => {
  const swept = rig();
  await startBatch(swept.store, swept.port, swept.batchId);
  await expireBatch(swept.store, swept.port, swept.onResolved, swept.batchId);
  const a = await applyBatchAnswers(swept.store, swept.port, swept.onResolved, swept.batchId, [{ questionId: "q1", selected: ["pg"] }]);
  assert.equal(a.batchStatus, "expired");
  assert.equal(a.results[0]!.status, "conflict");

  const late = rig(THREE_QUESTIONS, { timeoutAt: new Date(Date.now() - 1000).toISOString() });
  await startBatch(late.store, late.port, late.batchId);
  const b = await applyBatchAnswers(late.store, late.port, late.onResolved, late.batchId, [{ questionId: "q1", selected: ["pg"] }]);
  assert.equal(b.results[0]!.status, "conflict");
  assert.match(b.results[0]!.reason!, /expired/);
  assert.equal(late.row(0).status, "pending");
  assert.equal(late.results.length, 0);
});

test("an unknown batch is reported as unknown", async () => {
  const t = rig();
  const out = await applyBatchAnswers(t.store, t.port, t.onResolved, "nope", [{ questionId: "q1", selected: ["pg"] }]);
  assert.equal(out.batchStatus, "unknown");
});

test("invalid answers are rejected per question and leave that question untouched", async () => {
  const t = rig();
  await startBatch(t.store, t.port, t.batchId);
  const out = await applyBatchAnswers(t.store, t.port, t.onResolved, t.batchId, [
    { questionId: "q1", selected: ["mongo"] },
    { questionId: "q2", selected: [] },
    { questionId: "q3", text: "   " },
    { questionId: "q9", text: "x" },
    { questionId: "q9", text: "y" },
  ]);
  assert.deepEqual(out.results.map((r) => r.status), ["invalid", "invalid", "invalid", "invalid", "invalid"]);
  assert.equal(out.results[4]!.reason, "This question was sent twice.");
  assert.equal(t.row(0).status, "pending");
  assert.equal(t.row(1).status, "waiting");
  assert.equal(t.row(2).status, "waiting");
  assert.equal(t.port.sentQuestions, 1);
});

test("skip is allowed only where the chat flow shows a skip button", async () => {
  const t = rig();
  await startBatch(t.store, t.port, t.batchId);
  const out = await applyBatchAnswers(t.store, t.port, t.onResolved, t.batchId, [{ questionId: "q1", skip: true }, { questionId: "q3", skip: true }]);
  assert.equal(out.results[0]!.status, "invalid");
  assert.equal(out.results[1]!.status, "ok");
  assert.equal(t.row(2).status, "skipped");
  assert.equal(t.row(0).status, "pending");
});

test("one submit with an invalid answer in the middle still lets chat continue at that question", async () => {
  const t = rig();
  await startBatch(t.store, t.port, t.batchId);
  const out = await applyBatchAnswers(t.store, t.port, t.onResolved, t.batchId, [
    { questionId: "q1", selected: ["pg"] },
    { questionId: "q2", selected: ["nowhere"] },
    { questionId: "q3", text: "hello" },
  ]);
  assert.deepEqual(out.results.map((r) => r.status), ["ok", "invalid", "ok"]);
  assert.equal(out.batchStatus, "pending");
  // q2 was not answered, so it is the live chat question.
  assert.equal(t.row(1).status, "pending");
  assert.notEqual(t.row(1).message_id, null);
  assert.equal(t.row(2).status, "answered");
});

test("multiple choice plus a typed note keeps both, and a chat Other prompt is cleaned up", async () => {
  const t = rig();
  await startBatch(t.store, t.port, t.batchId);
  await applyAnswerSingle(t.store, t.port, t.onResolved, t.row(0).id, "pg");
  // q2 is live in chat; the user tapped Other there, so a prompt is open.
  await requestOther(t.store, t.port, t.row(1).id);
  t.store.updateQuestion(t.row(1).id, { force_reply_message_id: 555 });
  const out = await applyBatchAnswers(t.store, t.port, t.onResolved, t.batchId, [{ questionId: "q2", selected: ["us"], other: "and Mars" }]);
  assert.equal(out.results[0]!.status, "ok");
  assert.deepEqual(JSON.parse(t.row(1).selected_json!), ["us", "and Mars"]);
  assert.equal(t.port.deletedForceReplies >= 1, true);

  const t2 = rig();
  await startBatch(t2.store, t2.port, t2.batchId);
  await applyAnswerSingle(t2.store, t2.port, t2.onResolved, t2.row(0).id, "pg");
  await requestOther(t2.store, t2.port, t2.row(1).id);
  t2.store.updateQuestion(t2.row(1).id, { force_reply_message_id: 556 });
  const out2 = await applyBatchAnswers(t2.store, t2.port, t2.onResolved, t2.batchId, [{ questionId: "q2", selected: ["eu"] }]);
  assert.equal(out2.results[0]!.status, "ok");
  assert.deepEqual(JSON.parse(t2.row(1).selected_json!), ["eu"]);
  assert.equal(t2.row(1).status, "answered");
});

test("a single-choice question takes an own answer instead of an option", async () => {
  const t = rig();
  await startBatch(t.store, t.port, t.batchId);
  const out = await applyBatchAnswers(t.store, t.port, t.onResolved, t.batchId, [{ questionId: "q1", selected: [], other: "DuckDB" }]);
  assert.equal(out.results[0]!.status, "ok");
  assert.deepEqual(JSON.parse(t.row(0).selected_json!), ["DuckDB"]);
  const both = await applyBatchAnswers(t.store, t.port, t.onResolved, t.batchId, [{ questionId: "q2", selected: ["us"], other: "x" }]);
  assert.equal(both.results[0]!.status, "ok");
  const two = rig();
  await startBatch(two.store, two.port, two.batchId);
  const bad = await applyBatchAnswers(two.store, two.port, two.onResolved, two.batchId, [{ questionId: "q1", selected: ["pg"], other: "DuckDB" }]);
  assert.equal(bad.results[0]!.status, "invalid");
});

test("two submits at the same time apply one after the other, and the second sees the first", async () => {
  const t = rig();
  await startBatch(t.store, t.port, t.batchId);
  const [first, second] = await Promise.all([
    applyBatchAnswers(t.store, t.port, t.onResolved, t.batchId, [{ questionId: "q1", selected: ["pg"] }]),
    applyBatchAnswers(t.store, t.port, t.onResolved, t.batchId, [{ questionId: "q1", selected: ["sqlite"] }]),
  ]);
  assert.equal(first.results[0]!.status, "ok");
  assert.equal(second.results[0]!.status, "conflict");
  assert.deepEqual(JSON.parse(t.row(0).selected_json!), ["pg"]);
});

test("when the chat message for the next question cannot be sent, nothing is left stuck as live without a message", async () => {
  const t = rig();
  await startBatch(t.store, t.port, t.batchId);
  t.port.failNextSend = true;
  const out = await applyBatchAnswers(t.store, t.port, t.onResolved, t.batchId, [
    { questionId: "q1", selected: ["pg"] },
    { questionId: "q3", text: "x" },
  ]);
  // q1's answer was stored even though the chat message that followed it failed to send.
  assert.deepEqual(out.results.map((r) => r.status), ["ok", "ok"]);
  assert.equal(t.row(1).status, "pending");
  assert.notEqual(t.row(1).message_id, null);
  // No question is left live without a chat message to answer it from.
  for (const r of t.store.listQuestionsForBatch(t.batchId)) {
    if (r.status === "pending" || r.status === "awaiting_text") assert.notEqual(r.message_id, null, `question ${r.idx} is live with no chat message`);
  }
});

test("an answer from the app updates the chat message of a question that was already shown", async () => {
  const t = rig();
  await startBatch(t.store, t.port, t.batchId);
  await applyBatchAnswers(t.store, t.port, t.onResolved, t.batchId, [{ questionId: "q1", selected: ["pg"] }]);
  assert.deepEqual(t.port.resolvedViews, ["answered:(Recommended) Postgres"]);
});
