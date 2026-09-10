// Transport-neutral state machine for one question batch. A transport (currently
// transports/telegram) implements OutboundPort to actually render and send messages;
// this module owns all state transitions and resolve-once guarantees.

import type { Store, BatchRow, QuestionRow, BatchStatus } from "./store.ts";
import type { AskPayload, AskResult, AnswerEntry, Question } from "../contract/payload.ts";

export interface SentQuestion {
  messageId: number;
  forceReplyMessageId?: number;
}

export type ResolvedKind = "answered" | "skipped" | "cancelled" | "expired";

export interface OutboundPort {
  sendHeader(batch: BatchRow, payload: AskPayload): Promise<void>;
  sendQuestion(batch: BatchRow, question: Question, questionRow: QuestionRow, index: number, total: number, selected: string[]): Promise<SentQuestion>;
  editResolved(batch: BatchRow, question: Question, questionRow: QuestionRow, kind: ResolvedKind, answerText?: string): Promise<void>;
  deleteForceReply(batch: BatchRow, questionRow: QuestionRow): Promise<void>;
  sendBatchDone(batch: BatchRow): Promise<void>;
}

export type OnResolved = (batchId: string, result: AskResult) => void;

function questionFromPayload(payload: AskPayload, questionRow: QuestionRow): Question {
  const q = payload.questions[questionRow.idx];
  if (!q) throw new Error(`question index ${questionRow.idx} out of range for batch`);
  return q;
}

export async function startBatch(store: Store, port: OutboundPort, batchId: string): Promise<void> {
  const batch = store.getBatch(batchId);
  if (!batch) throw new Error(`unknown batch ${batchId}`);
  const payload = JSON.parse(batch.payload_json) as AskPayload;
  await port.sendHeader(batch, payload);
  await sendQuestionAtIndex(store, port, batch, payload, 0);
}

async function sendQuestionAtIndex(store: Store, port: OutboundPort, batch: BatchRow, payload: AskPayload, idx: number): Promise<void> {
  const rows = store.listQuestionsForBatch(batch.id);
  const row = rows.find((r) => r.idx === idx);
  if (!row) throw new Error(`no question row at idx ${idx} for batch ${batch.id}`);
  const question = questionFromPayload(payload, row);
  const sent = await port.sendQuestion(batch, question, row, idx, payload.questions.length, []);
  const status = question.type === "text" ? "awaiting_text" : "pending";
  store.updateQuestion(row.id, {
    status,
    message_id: sent.messageId,
    force_reply_message_id: sent.forceReplyMessageId ?? null,
    resolved_at: null,
  });
  store.appendAudit("question_sent", batch.id, row.id, { idx });
}

// After a question resolves, advance to the next `waiting` question, or finish the batch.
async function advanceOrFinish(store: Store, port: OutboundPort, onResolved: OnResolved, batchId: string): Promise<void> {
  const batch = store.getBatch(batchId);
  if (!batch) return;
  if (batch.status !== "pending") return;
  const payload = JSON.parse(batch.payload_json) as AskPayload;
  const rows = store.listQuestionsForBatch(batchId);
  const next = rows.find((r) => r.status === "waiting");
  if (next) {
    await sendQuestionAtIndex(store, port, batch, payload, next.idx);
    return;
  }
  // All questions resolved: finish.
  const result = buildResult(store, batch, payload, "submitted");
  store.updateBatchStatus(batchId, "submitted", JSON.stringify(result));
  store.appendAudit("batch_submitted", batchId, null, null);
  await port.sendBatchDone(batch);
  onResolved(batchId, result);
}

export function buildResult(store: Store, batch: BatchRow, payload: AskPayload, status: AskResult["status"]): AskResult {
  const answers: Record<string, AnswerEntry> = {};
  if (status !== "cancelled") {
    const rows = store.listQuestionsForBatch(batch.id);
    for (const question of payload.questions) {
      const row = rows.find((r) => r.idx === payload.questions.indexOf(question));
      answers[question.id] = rowToAnswer(question, row);
    }
  }
  const result: AskResult = {
    version: 1,
    status,
    askerPath: batch.asker_path,
    answers,
    annotations: {},
  };
  if (batch.asker_tmux_window) result.askerTmuxWindow = batch.asker_tmux_window;
  if (status === "submitted") result.submittedAt = new Date().toISOString();
  return result;
}

function rowToAnswer(question: Question, row: QuestionRow | undefined): AnswerEntry {
  if (!row || row.status === "skipped" || row.status === "expired" || row.status === "waiting") {
    return { value: null, notes: "" };
  }
  if (question.type === "multiple") {
    const selected = row.selected_json ? (JSON.parse(row.selected_json) as string[]) : [];
    return { value: selected, notes: "" };
  }
  if (question.type === "single") {
    const selected = row.selected_json ? (JSON.parse(row.selected_json) as string[]) : [];
    return { value: selected[0] ?? null, notes: "" };
  }
  return { value: row.text_answer ?? null, notes: "" };
}

export async function applyAnswerSingle(
  store: Store,
  port: OutboundPort,
  onResolved: OnResolved,
  questionId: string,
  value: string,
): Promise<void> {
  const row = store.getQuestion(questionId);
  if (!row || row.status !== "pending") return; // resolve-once
  const batch = store.getBatch(row.batch_id);
  if (!batch) return;
  const payload = JSON.parse(batch.payload_json) as AskPayload;
  const question = questionFromPayload(payload, row);
  store.updateQuestion(row.id, { status: "answered", selected_json: JSON.stringify([value]), resolved_at: new Date().toISOString() });
  store.appendAudit("question_answered", batch.id, row.id, { value });
  const label = question.options?.find((o) => o.value === value)?.label ?? value;
  await port.editResolved(batch, question, store.getQuestion(row.id)!, "answered", label);
  await advanceOrFinish(store, port, onResolved, batch.id);
}

export async function applyToggleMultiple(store: Store, questionId: string, value: string): Promise<string[]> {
  const row = store.getQuestion(questionId);
  if (!row || row.status !== "pending") return [];
  const current = row.selected_json ? (JSON.parse(row.selected_json) as string[]) : [];
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  store.updateQuestion(row.id, { selected_json: JSON.stringify(next) });
  return next;
}

export async function applyContinueMultiple(
  store: Store,
  port: OutboundPort,
  onResolved: OnResolved,
  questionId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const row = store.getQuestion(questionId);
  if (!row || row.status !== "pending") return { ok: false, reason: "This question is already resolved." };
  const batch = store.getBatch(row.batch_id);
  if (!batch) return { ok: false, reason: "Unknown batch." };
  const payload = JSON.parse(batch.payload_json) as AskPayload;
  const question = questionFromPayload(payload, row);
  const selected = row.selected_json ? (JSON.parse(row.selected_json) as string[]) : [];
  if (question.required && selected.length === 0) {
    return { ok: false, reason: "Select at least one option." };
  }
  store.updateQuestion(row.id, { status: "answered", resolved_at: new Date().toISOString() });
  store.appendAudit("question_answered", batch.id, row.id, { value: selected });
  const labels = selected.map((v) => question.options?.find((o) => o.value === v)?.label ?? v).join(", ");
  await port.editResolved(batch, question, store.getQuestion(row.id)!, "answered", labels || "(none)");
  await advanceOrFinish(store, port, onResolved, batch.id);
  return { ok: true };
}

export async function applyAnswerText(
  store: Store,
  port: OutboundPort,
  onResolved: OnResolved,
  questionId: string,
  text: string,
): Promise<void> {
  const row = store.getQuestion(questionId);
  if (!row || row.status !== "awaiting_text") return; // resolve-once
  const batch = store.getBatch(row.batch_id);
  if (!batch) return;
  const payload = JSON.parse(batch.payload_json) as AskPayload;
  const question = questionFromPayload(payload, row);

  if (question.type === "text") {
    store.updateQuestion(row.id, { status: "answered", text_answer: text, resolved_at: new Date().toISOString() });
  } else if (question.type === "single") {
    store.updateQuestion(row.id, { status: "answered", selected_json: JSON.stringify([text]), resolved_at: new Date().toISOString() });
  } else {
    // multiple: Other appends free text as an extra selected value
    const current = row.selected_json ? (JSON.parse(row.selected_json) as string[]) : [];
    const next = [...current, text];
    store.updateQuestion(row.id, { status: "answered", selected_json: JSON.stringify(next), resolved_at: new Date().toISOString() });
  }
  store.appendAudit("question_answered", batch.id, row.id, { text });
  await port.deleteForceReply(batch, store.getQuestion(row.id)!);
  const answerText = question.type === "multiple" ? await describeMultiple(store, row.id, question) : text;
  await port.editResolved(batch, question, store.getQuestion(row.id)!, "answered", answerText);
  await advanceOrFinish(store, port, onResolved, batch.id);
}

async function describeMultiple(store: Store, questionId: string, question: Question): Promise<string> {
  const row = store.getQuestion(questionId);
  const selected = row?.selected_json ? (JSON.parse(row.selected_json) as string[]) : [];
  return selected.map((v) => question.options?.find((o) => o.value === v)?.label ?? v).join(", ");
}

export async function requestOther(store: Store, port: OutboundPort, questionId: string): Promise<SentQuestion | undefined> {
  const row = store.getQuestion(questionId);
  if (!row || row.status !== "pending") return undefined;
  const batch = store.getBatch(row.batch_id);
  if (!batch) return undefined;
  store.updateQuestion(row.id, { status: "awaiting_text" });
  return undefined; // caller (handler) sends the ForceReply message and stores its id
}

export async function applySkip(store: Store, port: OutboundPort, onResolved: OnResolved, questionId: string): Promise<boolean> {
  const row = store.getQuestion(questionId);
  if (!row || (row.status !== "pending" && row.status !== "awaiting_text")) return false;
  const batch = store.getBatch(row.batch_id);
  if (!batch) return false;
  const payload = JSON.parse(batch.payload_json) as AskPayload;
  const question = questionFromPayload(payload, row);
  if (question.required) return false;
  store.updateQuestion(row.id, { status: "skipped", resolved_at: new Date().toISOString() });
  store.appendAudit("question_skipped", batch.id, row.id, null);
  if (row.force_reply_message_id) await port.deleteForceReply(batch, row);
  await port.editResolved(batch, question, store.getQuestion(row.id)!, "skipped");
  await advanceOrFinish(store, port, onResolved, batch.id);
  return true;
}

export async function cancelBatch(store: Store, port: OutboundPort, onResolved: OnResolved, batchId: string): Promise<void> {
  const batch = store.getBatch(batchId);
  if (!batch || batch.status !== "pending") return;
  const payload = JSON.parse(batch.payload_json) as AskPayload;
  const rows = store.listQuestionsForBatch(batchId);
  for (const row of rows) {
    if (row.status === "answered" || row.status === "skipped" || row.status === "cancelled" || row.status === "expired") continue;
    store.updateQuestion(row.id, { status: "cancelled", resolved_at: new Date().toISOString() });
    if (row.message_id) {
      const question = questionFromPayload(payload, row);
      if (row.force_reply_message_id) await port.deleteForceReply(batch, row);
      await port.editResolved(batch, question, store.getQuestion(row.id)!, "cancelled");
    }
  }
  const result = buildResult(store, batch, payload, "cancelled");
  store.updateBatchStatus(batchId, "cancelled", JSON.stringify(result));
  store.appendAudit("batch_cancelled", batchId, null, null);
  onResolved(batchId, result);
}

export async function expireBatch(store: Store, port: OutboundPort, onResolved: OnResolved, batchId: string): Promise<void> {
  const batch = store.getBatch(batchId);
  if (!batch || batch.status !== "pending") return;
  const payload = JSON.parse(batch.payload_json) as AskPayload;
  const rows = store.listQuestionsForBatch(batchId);
  const useDefaults = batch.on_timeout === "default";
  for (const row of rows) {
    if (row.status === "answered" || row.status === "skipped" || row.status === "cancelled" || row.status === "expired") continue;
    const question = questionFromPayload(payload, row);
    if (useDefaults && question.default !== undefined) {
      if (question.type === "multiple") {
        store.updateQuestion(row.id, { status: "answered", selected_json: JSON.stringify(question.default), resolved_at: new Date().toISOString() });
      } else if (question.type === "single") {
        store.updateQuestion(row.id, { status: "answered", selected_json: JSON.stringify([question.default]), resolved_at: new Date().toISOString() });
      } else {
        store.updateQuestion(row.id, { status: "answered", text_answer: String(question.default), resolved_at: new Date().toISOString() });
      }
      if (row.message_id) {
        if (row.force_reply_message_id) await port.deleteForceReply(batch, row);
        await port.editResolved(batch, question, store.getQuestion(row.id)!, "answered", "(default, timed out)");
      }
    } else {
      store.updateQuestion(row.id, { status: "expired", resolved_at: new Date().toISOString() });
      if (row.message_id) {
        if (row.force_reply_message_id) await port.deleteForceReply(batch, row);
        await port.editResolved(batch, question, store.getQuestion(row.id)!, "expired");
      }
    }
  }
  const result = buildResult(store, batch, payload, "expired");
  store.updateBatchStatus(batchId, "expired", JSON.stringify(result));
  store.appendAudit("batch_expired", batchId, null, null);
  onResolved(batchId, result);
}

export function isBatchTimedOut(batch: BatchRow, now = new Date()): boolean {
  if (!batch.timeout_at) return false;
  return new Date(batch.timeout_at).getTime() <= now.getTime();
}

export type { BatchStatus };
