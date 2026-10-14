// "Open in chat": moves the live question (or one chosen question) of a batch to a fresh chat
// message, so it can be answered with the chat buttons.
//
// Telegram has no link to a single message in a private chat, so the move is a repost: the bot
// sends the question again as a reply to its original message (which keeps the context one tap
// away), and the original becomes a "moved below" note. A question has exactly one live copy:
//   1. the new message id is stored (and the move written to the audit trail) before the old
//      copy is edited, and handler.ts refuses a tap on any message recorded as moved, so the old
//      buttons are dead even if the edit fails;
//   2. if the question was answered while the new message was being sent, the new message is
//      retracted and the caller is told about the conflict.
//
// Whole set: reposts every question that is live in chat now. The chat flow shows one question at
// a time, so that is the current question, and the rest follow in order as today, once it is
// answered. If nothing is live yet but questions are waiting, the next one is sent as usual.
// One question: a question already shown is reposted; a question not yet shown is sent now, ahead
// of its turn (interaction.ts then sends the questions before it as they come up).

import type { Store, QuestionRow } from "./store.ts";
import type { AskPayload } from "../contract/payload.ts";
import { advanceOrFinish, isBatchTimedOut, sendQuestionAtIndex } from "./interaction.ts";
import type { OutboundPort, OnResolved } from "./interaction.ts";
import { runExclusive, resolvedReason, batchReason } from "./answers.ts";

export interface ChatMoveOutcome {
  status: "ok" | "conflict" | "invalid" | "unknown";
  // Number of questions now live in chat because of this call.
  moved: number;
  reason?: string;
}

const isLive = (status: string): boolean => status === "pending" || status === "awaiting_text";

export function openInChat(store: Store, port: OutboundPort, onResolved: OnResolved, batchId: string, questionId?: string, now: Date = new Date()): Promise<ChatMoveOutcome> {
  return runExclusive(batchId, () => doOpen(store, port, onResolved, batchId, questionId, now));
}

async function doOpen(store: Store, port: OutboundPort, onResolved: OnResolved, batchId: string, questionId: string | undefined, now: Date): Promise<ChatMoveOutcome> {
  const batch = store.getBatch(batchId);
  if (!batch) return { status: "unknown", moved: 0, reason: "This set no longer exists." };
  if (batch.status !== "pending") return { status: "conflict", moved: 0, reason: batchReason(batch.status) };
  if (isBatchTimedOut(batch, now)) return { status: "conflict", moved: 0, reason: batchReason("expired") };
  const payload = JSON.parse(batch.payload_json) as AskPayload;
  const rows = store.listQuestionsForBatch(batchId);

  let targets: QuestionRow[];
  if (questionId !== undefined) {
    const idx = payload.questions.findIndex((q) => q.id === questionId);
    const row = rows.find((r) => r.idx === idx);
    if (!row) return { status: "invalid", moved: 0, reason: "Unknown question." };
    if (row.status !== "waiting" && !isLive(row.status)) return { status: "conflict", moved: 0, reason: resolvedReason(row.status) };
    targets = [row];
  } else {
    targets = rows.filter((r) => isLive(r.status) && r.message_id !== null);
    if (targets.length === 0) {
      const next = rows.find((r) => r.status === "waiting");
      if (!next) return { status: "conflict", moved: 0, reason: "Nothing in this set is waiting for an answer." };
      targets = [next];
    }
  }

  let moved = 0;
  let firstConflict: string | undefined;
  for (const target of targets) {
    const result = await moveOne(store, port, batchId, payload, target.id);
    if (result === "ok") moved++;
    else firstConflict ??= result;
  }
  // Nothing may be left with no live question in chat while some are still waiting.
  await advanceOrFinish(store, port, onResolved, batchId).catch(() => {});
  if (moved === 0 && firstConflict) return { status: "conflict", moved, reason: firstConflict };
  return { status: "ok", moved };
}

// Returns "ok", or the reason the question could not be moved.
async function moveOne(store: Store, port: OutboundPort, batchId: string, payload: AskPayload, rowId: string): Promise<string> {
  const batch = store.getBatch(batchId)!;
  const row = store.getQuestion(rowId)!;
  const question = payload.questions[row.idx]!;
  const total = payload.questions.length;

  if (row.status === "waiting") {
    await sendQuestionAtIndex(store, port, batch, payload, row.idx);
    return "ok";
  }
  if (!isLive(row.status)) return resolvedReason(row.status);
  if (row.message_id === null) return "This question is being answered. Try again in a moment.";

  const selected = row.selected_json ? (JSON.parse(row.selected_json) as string[]) : [];
  const oldMessageId = row.message_id;
  const oldForceReplyId = row.force_reply_message_id;
  const sent = await port.sendQuestion(batch, question, row, row.idx, total, selected, { replyToMessageId: oldMessageId });

  const fresh = store.getQuestion(rowId);
  if (!fresh || !isLive(fresh.status) || fresh.message_id !== oldMessageId) {
    await port.retract(batch, sent.messageId).catch(() => {});
    if (sent.forceReplyMessageId) await port.retract(batch, sent.forceReplyMessageId).catch(() => {});
    return fresh ? resolvedReason(fresh.status) : "This question no longer exists.";
  }
  // A choice question whose "Other" prompt was open starts again from its buttons.
  // One transaction: the dead-old-copy record and the new message id are written together.
  store.inTransaction(() => {
    store.updateQuestion(rowId, {
      message_id: sent.messageId,
      force_reply_message_id: sent.forceReplyMessageId ?? null,
      status: question.type === "text" ? "awaiting_text" : "pending",
    });
    store.appendAudit("question_moved", batchId, rowId, { from: oldMessageId, to: sent.messageId, fromForce: oldForceReplyId });
  });
  await port.markMoved(batch, question, oldMessageId, oldForceReplyId).catch(() => {});
  return "ok";
}
