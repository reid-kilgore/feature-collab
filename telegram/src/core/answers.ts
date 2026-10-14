// Applies a set of answers submitted together (the Telegram Mini App) to one batch. Every
// answer goes through the same applyAnswer* / applySkip functions the chat buttons use, so the
// waiting `tg ask` caller is resolved the usual way and the chat messages stay correct.
//
// Two rules keep a partial or conflicting submit from leaving the batch in a state the chat
// flow cannot continue from:
//   1. Everything is validated before anything is changed. A question that is already resolved,
//      unknown, or malformed gets a per-question result and is left exactly as it was.
//   2. A `waiting` question that this submit answers is marked live first (it has no chat
//      message yet), so the chat flow does not send it a moment before it is answered. If an
//      answer then fails, those marks are rolled back to `waiting` and the chat flow is nudged
//      to send the next unanswered question.

import type { Store, BatchRow, QuestionRow, BatchStatus } from "./store.ts";
import type { AskPayload, Question } from "../contract/payload.ts";
import {
  applyAnswerSingle,
  applyAnswerText,
  applyContinueMultiple,
  applySkip,
  advanceOrFinish,
  isBatchTimedOut,
} from "./interaction.ts";
import type { OutboundPort, OnResolved } from "./interaction.ts";

export const MAX_TEXT_LENGTH = 4000;

export interface Submission {
  questionId: string;
  selected?: string[];
  other?: string;
  text?: string;
  skip?: boolean;
}

export type SubmissionStatus = "ok" | "conflict" | "invalid" | "error";

export interface SubmissionResult {
  questionId: string;
  status: SubmissionStatus;
  reason?: string;
}

export interface SubmitOutcome {
  batchStatus: BatchStatus | "unknown";
  results: SubmissionResult[];
}

const isLive = (status: string): boolean => status === "pending" || status === "awaiting_text";

function resolvedReason(status: string): string {
  switch (status) {
    case "answered":
      return "Already answered in chat. Your answer was not used.";
    case "skipped":
      return "Already skipped in chat. Your answer was not used.";
    case "cancelled":
      return "This question was cancelled.";
    case "expired":
      return "This question expired.";
    default:
      return "This question changed while you were answering. Your answer was not used.";
  }
}

function batchReason(status: string): string {
  switch (status) {
    case "cancelled":
      return "This set was cancelled.";
    case "expired":
      return "This set expired.";
    case "submitted":
      return "This set is already complete.";
    default:
      return "This set is no longer open.";
  }
}

// Returns a problem description, or undefined when the submission is well formed for the question.
export function validateSubmission(question: Question, sub: Submission): string | undefined {
  if (sub.skip) {
    if (question.required !== false) return "This question cannot be skipped.";
    return undefined;
  }
  const options = new Set((question.options ?? []).map((o) => o.value));
  const other = sub.other?.trim();
  const text = sub.text?.trim();
  if (question.type === "text") {
    if (!text) return "Write an answer.";
    if (text.length > MAX_TEXT_LENGTH) return "That answer is too long.";
    return undefined;
  }
  const selected = sub.selected ?? [];
  if (new Set(selected).size !== selected.length) return "An option was chosen twice.";
  if (selected.some((v) => !options.has(v))) return "That option does not exist.";
  if (other !== undefined) {
    if (question.allowOther === false) return "This question does not accept another answer.";
    if (!other) return "Write your own answer, or clear the field.";
    if (other.length > MAX_TEXT_LENGTH) return "That answer is too long.";
  }
  if (question.type === "single") {
    if (selected.length + (other ? 1 : 0) !== 1) return "Choose exactly one option.";
    return undefined;
  }
  if (selected.length === 0 && !other) return "Choose at least one option.";
  return undefined;
}

interface Planned {
  sub: Submission;
  question: Question;
  rowId: string;
  idx: number;
  premarked: boolean;
}

// One submit at a time per batch, so two phones (or a double tap) cannot interleave.
const chains = new Map<string, Promise<unknown>>();

export function applyBatchAnswers(
  store: Store,
  port: OutboundPort,
  onResolved: OnResolved,
  batchId: string,
  submissions: Submission[],
  now: Date = new Date(),
): Promise<SubmitOutcome> {
  const previous = chains.get(batchId) ?? Promise.resolve();
  const run = previous.then(() => doApply(store, port, onResolved, batchId, submissions, now));
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  chains.set(batchId, tail);
  void tail.then(() => {
    if (chains.get(batchId) === tail) chains.delete(batchId);
  });
  return run;
}

async function doApply(
  store: Store,
  port: OutboundPort,
  onResolved: OnResolved,
  batchId: string,
  submissions: Submission[],
  now: Date,
): Promise<SubmitOutcome> {
  const all = (status: SubmissionStatus, reason: string): SubmissionResult[] =>
    submissions.map((s) => ({ questionId: s.questionId, status, reason }));

  const batch = store.getBatch(batchId);
  if (!batch) return { batchStatus: "unknown", results: all("conflict", "This set no longer exists.") };
  if (batch.status !== "pending") return { batchStatus: batch.status, results: all("conflict", batchReason(batch.status)) };
  if (isBatchTimedOut(batch, now)) return { batchStatus: batch.status, results: all("conflict", batchReason("expired")) };

  const payload = JSON.parse(batch.payload_json) as AskPayload;
  const rows = store.listQuestionsForBatch(batchId);
  const results = new Map<number, SubmissionResult>();
  const planned: Array<Planned & { order: number }> = [];
  const seen = new Set<string>();

  submissions.forEach((sub, order) => {
    const fail = (status: SubmissionStatus, reason: string) => results.set(order, { questionId: sub.questionId, status, reason });
    if (seen.has(sub.questionId)) return fail("invalid", "This question was sent twice.");
    seen.add(sub.questionId);
    const idx = payload.questions.findIndex((q) => q.id === sub.questionId);
    const question = payload.questions[idx];
    const row = rows.find((r) => r.idx === idx);
    if (!question || !row) return fail("invalid", "Unknown question.");
    if (row.status !== "waiting" && !isLive(row.status)) return fail("conflict", resolvedReason(row.status));
    const problem = validateSubmission(question, sub);
    if (problem) return fail("invalid", problem);
    planned.push({ sub, question, rowId: row.id, idx, premarked: false, order });
  });
  planned.sort((a, b) => a.idx - b.idx);

  // Mark waiting questions live before any answer is applied (rule 2 above).
  for (const p of planned) {
    const row = store.getQuestion(p.rowId)!;
    if (row.status !== "waiting") continue;
    const needsText = p.question.type === "text" || p.sub.other !== undefined;
    store.updateQuestion(row.id, { status: needsText ? "awaiting_text" : "pending" });
    p.premarked = true;
  }

  const counts = { ok: 0, conflict: 0, invalid: 0, error: 0 };
  try {
    for (const p of planned) {
      const done = (status: SubmissionStatus, reason?: string) => results.set(p.order, { questionId: p.sub.questionId, status, ...(reason ? { reason } : {}) });
      try {
        const row = store.getQuestion(p.rowId)!;
        if (!isLive(row.status)) {
          done("conflict", resolvedReason(row.status));
          continue;
        }
        const failure = await applyOne(store, port, onResolved, batch, p, row);
        const after = store.getQuestion(p.rowId)!;
        if (failure) done("conflict", failure);
        else if (after.status === "answered" || after.status === "skipped") done("ok");
        else done("conflict", resolvedReason(after.status));
      } catch {
        // The answer may have been stored before a later step (the next chat message) failed.
        const after = store.getQuestion(p.rowId);
        if (after && (after.status === "answered" || after.status === "skipped")) done("ok");
        else done("error", "Could not send this answer. Try again.");
      }
    }
  } finally {
    for (const p of planned) {
      const row = store.getQuestion(p.rowId);
      if (p.premarked && row && isLive(row.status) && row.message_id === null) {
        store.updateQuestion(row.id, { status: "waiting", selected_json: null, text_answer: null });
      }
    }
    try {
      await advanceOrFinish(store, port, onResolved, batchId);
    } catch {
      // best-effort: the chat flow's own recovery handles the rest
    }
  }

  const ordered = submissions.map((_s, order) => results.get(order)!);
  for (const r of ordered) counts[r.status]++;
  store.appendAudit("miniapp_submit", batchId, null, counts);
  return { batchStatus: store.getBatch(batchId)?.status ?? "unknown", results: ordered };
}

// Applies one validated submission. Returns a conflict reason when the state changed under it.
async function applyOne(store: Store, port: OutboundPort, onResolved: OnResolved, batch: BatchRow, p: Planned, row: QuestionRow): Promise<string | undefined> {
  const { sub, question } = p;
  if (sub.skip) {
    const ok = await applySkip(store, port, onResolved, row.id);
    return ok ? undefined : "This question could not be skipped.";
  }
  if (question.type === "text") {
    await applyAnswerText(store, port, onResolved, row.id, sub.text!.trim());
    return undefined;
  }
  const other = sub.other?.trim();
  if (other) {
    // A free-text answer to a choice question. Multiple choice keeps the chosen options and adds the text.
    if (question.type === "multiple") store.updateQuestion(row.id, { selected_json: JSON.stringify(sub.selected ?? []) });
    if (row.status === "pending") store.updateQuestion(row.id, { status: "awaiting_text" });
    await applyAnswerText(store, port, onResolved, row.id, other);
    return undefined;
  }
  // A chat "Other" prompt may be open for this question; the options chosen here replace it.
  if (row.status === "awaiting_text") {
    if (row.force_reply_message_id) {
      await port.deleteForceReply(batch, row);
      store.updateQuestion(row.id, { force_reply_message_id: null });
    }
    const current = store.getQuestion(row.id)!;
    if (current.status !== "awaiting_text") return resolvedReason(current.status);
    store.updateQuestion(row.id, { status: "pending" });
  }
  if (question.type === "single") {
    await applyAnswerSingle(store, port, onResolved, row.id, sub.selected![0]!);
    return undefined;
  }
  store.updateQuestion(row.id, { selected_json: JSON.stringify(sub.selected ?? []) });
  const outcome = await applyContinueMultiple(store, port, onResolved, row.id);
  return outcome.ok ? undefined : (outcome.reason ?? "This question could not be answered.");
}
