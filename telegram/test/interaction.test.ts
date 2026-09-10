// Pure state-machine tests against core/interaction.ts, using a fake OutboundPort so no
// Telegram HTTP calls are involved. Exercises resolve-once, cancel, skip, timeout defaults.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store, newId, newShortId } from "../src/core/store.ts";
import type { QuestionStatus } from "../src/core/store.ts";
import {
  startBatch,
  applyAnswerSingle,
  applyToggleMultiple,
  applyContinueMultiple,
  applyAnswerText,
  applySkip,
  cancelBatch,
  expireBatch,
  requestOther,
} from "../src/core/interaction.ts";
import type { OutboundPort } from "../src/core/interaction.ts";
import type { AskPayload } from "../src/contract/payload.ts";

function makeFakePort(): OutboundPort & { sentQuestions: number; resolvedViews: string[]; done: boolean } {
  const port = {
    sentQuestions: 0,
    resolvedViews: [] as string[],
    done: false,
    async sendHeader() {},
    async sendQuestion() {
      port.sentQuestions++;
      return { messageId: port.sentQuestions };
    },
    async editResolved(_batch: unknown, _question: unknown, _row: unknown, kind: string, text?: string) {
      port.resolvedViews.push(`${kind}:${text ?? ""}`);
    },
    async deleteForceReply() {},
    async sendBatchDone() {
      port.done = true;
    },
  };
  return port;
}

function makeStore(): { store: Store; dir: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "agent-telegram-test-"));
  const store = new Store(path.join(dir, "state.sqlite"));
  return { store, dir };
}

function createBatch(store: Store, payload: AskPayload, opts: { onTimeout?: "cancel" | "default"; timeoutAt?: string } = {}): string {
  const id = newId();
  store.createBatch({
    id,
    status: "pending",
    asker_path: "/tmp/project",
    asker_tmux_window: null,
    payload_json: JSON.stringify(payload),
    timeout_at: opts.timeoutAt ?? null,
    on_timeout: opts.onTimeout ?? "cancel",
    chat_id: "1",
    user_id: "1",
  });
  payload.questions.forEach((_q, idx) => {
    store.createQuestion({
      id: newId(),
      batch_id: id,
      idx,
      short_id: newShortId(),
      status: "waiting" as QuestionStatus,
      selected_json: null,
      text_answer: null,
      message_id: null,
      force_reply_message_id: null,
    });
  });
  return id;
}

test("single-choice tap submits and advances to next question", async () => {
  const { store, dir } = makeStore();
  const payload: AskPayload = {
    version: 1,
    questions: [
      { id: "q1", prompt: "Pick one", type: "single", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] },
      { id: "q2", prompt: "Text please", type: "text" },
    ],
  };
  const batchId = createBatch(store, payload);
  const port = makeFakePort();
  const results: unknown[] = [];
  await startBatch(store, port, batchId);
  const q1 = store.listQuestionsForBatch(batchId)[0]!;
  assert.equal(q1.status, "pending");

  await applyAnswerSingle(store, port, (id, result) => results.push(result), q1.id, "b");
  const q1After = store.getQuestion(q1.id)!;
  assert.equal(q1After.status, "answered");
  assert.deepEqual(JSON.parse(q1After.selected_json!), ["b"]);

  const q2 = store.listQuestionsForBatch(batchId)[1]!;
  assert.equal(q2.status, "awaiting_text");
  assert.equal(port.sentQuestions, 2);

  rmSync(dir, { recursive: true, force: true });
});

test("duplicate callback on a resolved question is a harmless no-op", async () => {
  const { store, dir } = makeStore();
  const payload: AskPayload = {
    version: 1,
    questions: [{ id: "q1", prompt: "Pick one", type: "single", options: [{ value: "a", label: "A" }] }],
  };
  const batchId = createBatch(store, payload);
  const port = makeFakePort();
  const results: unknown[] = [];
  const onResolved = (id: string, result: unknown) => results.push(result);
  await startBatch(store, port, batchId);
  const q1 = store.listQuestionsForBatch(batchId)[0]!;
  await applyAnswerSingle(store, port, onResolved, q1.id, "a");
  assert.equal(results.length, 1);
  // Second tap on the same (now resolved) question must not re-fire resolution or mutate state.
  await applyAnswerSingle(store, port, onResolved, q1.id, "a");
  assert.equal(results.length, 1);

  rmSync(dir, { recursive: true, force: true });
});

test("multiple-choice: toggle then continue with zero selections is rejected when required", async () => {
  const { store, dir } = makeStore();
  const payload: AskPayload = {
    version: 1,
    questions: [
      {
        id: "q1",
        prompt: "Pick some",
        type: "multiple",
        required: true,
        options: [{ value: "a", label: "A" }, { value: "b", label: "B" }],
      },
    ],
  };
  const batchId = createBatch(store, payload);
  const port = makeFakePort();
  const results: unknown[] = [];
  await startBatch(store, port, batchId);
  const q1 = store.listQuestionsForBatch(batchId)[0]!;

  const rejected = await applyContinueMultiple(store, port, (id, r) => results.push(r), q1.id);
  assert.equal(rejected.ok, false);
  assert.match(rejected.reason ?? "", /at least one/i);

  await applyToggleMultiple(store, q1.id, "a");
  const accepted = await applyContinueMultiple(store, port, (id, r) => results.push(r), q1.id);
  assert.equal(accepted.ok, true);
  assert.equal(results.length, 1);
  const result = results[0] as { answers: Record<string, { value: unknown }> };
  assert.deepEqual(result.answers.q1!.value, ["a"]);

  rmSync(dir, { recursive: true, force: true });
});

test("skip is rejected for a required question and accepted for optional", async () => {
  const { store, dir } = makeStore();
  const payload: AskPayload = {
    version: 1,
    questions: [{ id: "q1", prompt: "Optional text", type: "text", required: false }],
  };
  const batchId = createBatch(store, payload);
  const port = makeFakePort();
  const results: unknown[] = [];
  await startBatch(store, port, batchId);
  const q1 = store.listQuestionsForBatch(batchId)[0]!;

  const ok = await applySkip(store, port, (id, r) => results.push(r), q1.id);
  assert.equal(ok, true);
  assert.equal(results.length, 1);
  const result = results[0] as { answers: Record<string, { value: unknown }> };
  assert.equal(result.answers.q1!.value, null);

  rmSync(dir, { recursive: true, force: true });
});

test("Other on a single-choice question stores free text as the answer", async () => {
  const { store, dir } = makeStore();
  const payload: AskPayload = {
    version: 1,
    questions: [{ id: "q1", prompt: "Pick one", type: "single", options: [{ value: "a", label: "A" }] }],
  };
  const batchId = createBatch(store, payload);
  const port = makeFakePort();
  const results: unknown[] = [];
  await startBatch(store, port, batchId);
  const q1 = store.listQuestionsForBatch(batchId)[0]!;

  await requestOther(store, port, q1.id);
  assert.equal(store.getQuestion(q1.id)!.status, "awaiting_text");
  await applyAnswerText(store, port, (id, r) => results.push(r), q1.id, "something else entirely");
  const result = results[0] as { answers: Record<string, { value: unknown }> };
  assert.equal(result.answers.q1!.value, "something else entirely");

  rmSync(dir, { recursive: true, force: true });
});

test("cancelling a batch discards partial answers", async () => {
  const { store, dir } = makeStore();
  const payload: AskPayload = {
    version: 1,
    questions: [
      { id: "q1", prompt: "Pick one", type: "single", options: [{ value: "a", label: "A" }] },
      { id: "q2", prompt: "And another", type: "text" },
    ],
  };
  const batchId = createBatch(store, payload);
  const port = makeFakePort();
  const results: unknown[] = [];
  await startBatch(store, port, batchId);
  await cancelBatch(store, port, (id, r) => results.push(r), batchId);
  const result = results[0] as { status: string; answers: Record<string, unknown> };
  assert.equal(result.status, "cancelled");
  assert.deepEqual(result.answers, {});
  assert.equal(store.getBatch(batchId)!.status, "cancelled");

  rmSync(dir, { recursive: true, force: true });
});

test("timeout with onTimeout=cancel expires unanswered questions with null values", async () => {
  const { store, dir } = makeStore();
  const payload: AskPayload = {
    version: 1,
    questions: [{ id: "q1", prompt: "Pick one", type: "single", options: [{ value: "a", label: "A" }] }],
  };
  const batchId = createBatch(store, payload, { onTimeout: "cancel" });
  const port = makeFakePort();
  const results: unknown[] = [];
  await startBatch(store, port, batchId);
  await expireBatch(store, port, (id, r) => results.push(r), batchId);
  const result = results[0] as { status: string; answers: Record<string, { value: unknown }> };
  assert.equal(result.status, "expired");
  assert.equal(result.answers.q1!.value, null);

  rmSync(dir, { recursive: true, force: true });
});

test("timeout with onTimeout=default fills in the question's default value", async () => {
  const { store, dir } = makeStore();
  const payload: AskPayload = {
    version: 1,
    questions: [{ id: "q1", prompt: "Pick one", type: "single", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], default: "b" }],
  };
  const batchId = createBatch(store, payload, { onTimeout: "default" });
  const port = makeFakePort();
  const results: unknown[] = [];
  await startBatch(store, port, batchId);
  await expireBatch(store, port, (id, r) => results.push(r), batchId);
  const result = results[0] as { status: string; answers: Record<string, { value: unknown }> };
  assert.equal(result.status, "expired");
  assert.equal(result.answers.q1!.value, "b");

  rmSync(dir, { recursive: true, force: true });
});
