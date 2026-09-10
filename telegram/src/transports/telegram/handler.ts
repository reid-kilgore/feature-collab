// Telegram Update -> interaction transitions (callbacks, replies, commands).

import type { Store, QuestionRow, BatchRow } from "../../core/store.ts";
import type { OutboundPort, OnResolved, SentQuestion, ResolvedKind } from "../../core/interaction.ts";
import {
  applyAnswerSingle,
  applyToggleMultiple,
  applyContinueMultiple,
  applyAnswerText,
  applySkip,
  cancelBatch,
  requestOther,
} from "../../core/interaction.ts";
import path from "node:path";
import os from "node:os";
import { writeFileSync, unlinkSync, mkdtempSync, mkdirSync } from "node:fs";
import type { AskPayload, Question } from "../../contract/payload.ts";
import { inboxDir } from "../../config.ts";
import { TelegramApi } from "./api.ts";
import {
  renderQuestionView,
  renderForceReplyPrompt,
  renderResolvedView,
  renderHeader,
  renderBatchDone,
  decodeCallback,
} from "./render.ts";

function sanitizeFilename(title: string): string {
  return title.replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 60) || "document";
}

export interface AllowedIdentity {
  chatId: string;
  userId: string;
}

export function createTelegramPort(api: TelegramApi, hostname: string): OutboundPort {
  return {
    async sendHeader(batch, payload: AskPayload) {
      const text = renderHeader(payload, hostname);
      if (text) await api.sendMessage(batch.chat_id, text, { html: true });
      if (payload.documents?.length) {
        for (const doc of payload.documents) {
          const dir = mkdtempSync(path.join(os.tmpdir(), "agent-telegram-doc-"));
          const filePath = path.join(dir, `${sanitizeFilename(doc.title)}.md`);
          writeFileSync(filePath, doc.markdown ?? "");
          try {
            await api.sendDocument(batch.chat_id, filePath, `📄 ${doc.title}`);
          } finally {
            try {
              unlinkSync(filePath);
            } catch {
              // ignore
            }
          }
        }
      }
    },
    async sendQuestion(batch, question: Question, questionRow: QuestionRow, index, total, selected): Promise<SentQuestion> {
      const view = renderQuestionView({ shortId: questionRow.short_id, index, total, question, selected });
      const sent = await api.sendMessage(batch.chat_id, view.text, { html: true, replyMarkup: view.replyMarkup });
      if (question.type === "text") {
        const prompt = renderForceReplyPrompt();
        const forceSent = await api.sendMessage(batch.chat_id, prompt.text, { replyMarkup: prompt.replyMarkup });
        return { messageId: sent.message_id, forceReplyMessageId: forceSent.message_id };
      }
      return { messageId: sent.message_id };
    },
    async editResolved(batch, question: Question, questionRow: QuestionRow, kind: ResolvedKind, answerText?: string) {
      if (!questionRow.message_id) return;
      const text = renderResolvedView(question, kind, answerText);
      try {
        await api.editMessageText(batch.chat_id, questionRow.message_id, text, { html: true });
      } catch {
        // message may already be edited/deleted; best-effort
      }
    },
    async deleteForceReply(batch, questionRow: QuestionRow) {
      if (questionRow.force_reply_message_id) await api.deleteMessage(batch.chat_id, questionRow.force_reply_message_id);
    },
    async sendBatchDone(batch: BatchRow) {
      const text = renderBatchDone(path.basename(batch.asker_path), batch.asker_tmux_window ?? undefined);
      await api.sendMessage(batch.chat_id, text, { html: true });
    },
  };
}

export interface HandlerContext {
  store: Store;
  api: TelegramApi;
  port: OutboundPort;
  onResolved: OnResolved;
  allowed: AllowedIdentity;
  daemonStartedAt: Date;
  isListening: () => boolean;
  notifyInbox: () => void;
  // Inbox routing with several agents sharing one daemon (DESIGN.md "Inbox routing with
  // several agents"): resolve which channel a free-form message belongs to.
  channelForMessage: (messageId: number) => string | undefined;
  pickActiveChannel: () => string | undefined;
}

// Minimal shapes of the Telegram Update we read. Everything else is ignored.
interface TgUser {
  id: number;
}
interface TgChat {
  id: number;
}
interface TgPhotoSize {
  file_id: string;
}
interface TgDocument {
  file_id: string;
  file_name?: string;
}
interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  text?: string;
  caption?: string;
  reply_to_message?: { message_id: number };
  photo?: TgPhotoSize[];
  document?: TgDocument;
}
interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
}
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

export async function handleUpdate(ctx: HandlerContext, update: TgUpdate): Promise<void> {
  if (update.callback_query) {
    await handleCallback(ctx, update.callback_query);
    return;
  }
  if (update.message) {
    await handleMessage(ctx, update.message);
  }
}

function isAllowed(ctx: HandlerContext, chatId: number | undefined, userId: number | undefined): boolean {
  if (chatId === undefined || userId === undefined) return false;
  return String(chatId) === ctx.allowed.chatId && String(userId) === ctx.allowed.userId;
}

async function handleCallback(ctx: HandlerContext, cq: TgCallbackQuery): Promise<void> {
  const chatId = cq.message?.chat.id;
  if (!isAllowed(ctx, chatId, cq.from.id)) {
    ctx.store.appendAudit("unauthorized_update", null, null, { kind: "callback_query", chatId, userId: cq.from.id });
    // Telegram requires answering every callback query even when dropped, or the client spins.
    await ctx.api.answerCallbackQuery(cq.id).catch(() => {});
    return;
  }
  const data = cq.data ?? "";
  if (data.startsWith("confirmcancel:") || data === "abortcancel") {
    await handleCancelConfirmation(ctx, cq, data);
    return;
  }
  const decoded = decodeCallback(data);
  if (!decoded) {
    await ctx.api.answerCallbackQuery(cq.id).catch(() => {});
    return;
  }
  const row = ctx.store.getQuestionByShortId(decoded.shortId);
  if (!row) {
    await ctx.api.answerCallbackQuery(cq.id, "This question is already resolved.").catch(() => {});
    return;
  }
  const isLive = row.status === "pending" || row.status === "awaiting_text";
  if (!isLive) {
    await ctx.api.answerCallbackQuery(cq.id, "This question is already resolved.").catch(() => {});
    return;
  }

  const batch = ctx.store.getBatch(row.batch_id);
  const payload = batch ? (JSON.parse(batch.payload_json) as AskPayload) : undefined;
  const question = payload?.questions[row.idx];

  switch (decoded.action) {
    case "s": {
      if (!question?.options || decoded.arg === undefined) break;
      const option = question.options[decoded.arg];
      if (!option) break;
      await applyAnswerSingle(ctx.store, ctx.port, ctx.onResolved, row.id, option.value);
      await ctx.api.answerCallbackQuery(cq.id).catch(() => {});
      return;
    }
    case "t": {
      if (!question?.options || decoded.arg === undefined) break;
      const option = question.options[decoded.arg];
      if (!option) break;
      const selected = await applyToggleMultiple(ctx.store, row.id, option.value);
      const view = renderQuestionView({ shortId: row.short_id, index: row.idx, total: payload!.questions.length, question, selected });
      if (row.message_id) {
        await ctx.api.editMessageText(batch!.chat_id, row.message_id, view.text, { html: true, replyMarkup: view.replyMarkup }).catch(() => {});
      }
      await ctx.api.answerCallbackQuery(cq.id).catch(() => {});
      return;
    }
    case "go": {
      const outcome = await applyContinueMultiple(ctx.store, ctx.port, ctx.onResolved, row.id);
      await ctx.api.answerCallbackQuery(cq.id, outcome.ok ? undefined : outcome.reason, !outcome.ok).catch(() => {});
      return;
    }
    case "other": {
      await requestOther(ctx.store, ctx.port, row.id);
      const prompt = renderForceReplyPrompt();
      const sent = await ctx.api.sendMessage(batch!.chat_id, prompt.text, { replyMarkup: prompt.replyMarkup });
      ctx.store.updateQuestion(row.id, { force_reply_message_id: sent.message_id });
      await ctx.api.answerCallbackQuery(cq.id).catch(() => {});
      return;
    }
    case "skip": {
      const ok = await applySkip(ctx.store, ctx.port, ctx.onResolved, row.id);
      await ctx.api.answerCallbackQuery(cq.id, ok ? undefined : "This question is required.", !ok).catch(() => {});
      return;
    }
    case "x": {
      await cancelBatch(ctx.store, ctx.port, ctx.onResolved, row.batch_id);
      await ctx.api.answerCallbackQuery(cq.id, "Batch cancelled.").catch(() => {});
      return;
    }
  }
  await ctx.api.answerCallbackQuery(cq.id).catch(() => {});
}

async function handleCancelConfirmation(ctx: HandlerContext, cq: TgCallbackQuery, data: string): Promise<void> {
  if (data === "abortcancel") {
    if (cq.message) await ctx.api.editMessageText(String(cq.message.chat.id), cq.message.message_id, "Not cancelled.").catch(() => {});
    await ctx.api.answerCallbackQuery(cq.id).catch(() => {});
    return;
  }
  const batchId = data.slice("confirmcancel:".length);
  await cancelBatch(ctx.store, ctx.port, ctx.onResolved, batchId);
  if (cq.message) await ctx.api.editMessageText(String(cq.message.chat.id), cq.message.message_id, "Cancelled.").catch(() => {});
  await ctx.api.answerCallbackQuery(cq.id).catch(() => {});
}

async function handleMessage(ctx: HandlerContext, message: TgMessage): Promise<void> {
  if (!isAllowed(ctx, message.chat.id, message.from?.id)) {
    ctx.store.appendAudit("unauthorized_update", null, null, { kind: "message", chatId: message.chat.id, userId: message.from?.id });
    return; // never reply to an unauthorized chat
  }

  const text = (message.text ?? "").trim();

  if (message.reply_to_message) {
    const replyToId = message.reply_to_message.message_id;
    const row = ctx.store.listPendingQuestions().find((r) => r.force_reply_message_id === replyToId && r.status === "awaiting_text");
    if (row) {
      await applyAnswerText(ctx.store, ctx.port, ctx.onResolved, row.id, text);
      return;
    }
    // A reply to something other than a tracked question prompt is ordinary conversation.
  }

  if (text === "/status") {
    const pending = ctx.store.listPendingQuestions();
    const uptimeSeconds = Math.floor((Date.now() - ctx.daemonStartedAt.getTime()) / 1000);
    const unread = ctx.store.countUnreadInbox();
    const listening = ctx.isListening() ? "yes" : "no";
    await ctx.api.sendMessage(
      String(message.chat.id),
      `Pending questions: ${pending.length}\nUnread inbox: ${unread}\nAgent listening: ${listening}\nDaemon uptime: ${uptimeSeconds}s`,
    );
    return;
  }
  if (text === "/pending") {
    const pending = ctx.store.listPendingQuestions()[0];
    if (!pending) {
      await ctx.api.sendMessage(String(message.chat.id), "No pending questions.");
      return;
    }
    const batch = ctx.store.getBatch(pending.batch_id);
    if (!batch) return;
    const payload = JSON.parse(batch.payload_json) as AskPayload;
    const question = payload.questions[pending.idx]!;
    const selected = pending.selected_json ? (JSON.parse(pending.selected_json) as string[]) : [];
    const view = renderQuestionView({ shortId: pending.short_id, index: pending.idx, total: payload.questions.length, question, selected });
    await ctx.api.sendMessage(String(message.chat.id), view.text, { html: true, replyMarkup: view.replyMarkup });
    return;
  }
  if (text === "/cancel") {
    const batches = ctx.store.listPendingBatches();
    const batch = batches[0];
    if (!batch) {
      await ctx.api.sendMessage(String(message.chat.id), "No pending questions.");
      return;
    }
    await ctx.api.sendMessage(String(message.chat.id), "Cancel the current question batch?", {
      replyMarkup: {
        inline_keyboard: [
          [
            { text: "Yes, cancel", callback_data: `confirmcancel:${batch.id}` },
            { text: "No", callback_data: "abortcancel" },
          ],
        ],
      },
    });
    return;
  }
  if (text === "/help") {
    await ctx.api.sendMessage(
      String(message.chat.id),
      "Commands:\n/status - pending questions, unread inbox count, listening state\n/pending - resend the current question\n/cancel - cancel the current question batch\n/help - this message\n\nAnything else you send goes to the agent's inbox (tg recv).",
    );
    return;
  }

  // Not a reply to a question, not a command: this is free-form conversation for the
  // agent's inbox, not a hint. Text, photos, and documents are all accepted.
  await addToInbox(ctx, message);
}

async function addToInbox(ctx: HandlerContext, message: TgMessage): Promise<void> {
  let photoPath: string | null = null;
  let filePath: string | null = null;

  if (message.photo?.length) {
    const largest = message.photo[message.photo.length - 1]!;
    photoPath = await downloadAttachment(ctx, largest.file_id, "jpg");
  }
  if (message.document) {
    const ext = message.document.file_name ? path.extname(message.document.file_name).replace(/^\./, "") || "bin" : "bin";
    filePath = await downloadAttachment(ctx, message.document.file_id, ext);
  }

  const text = message.text ?? message.caption ?? null;
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Routing (DESIGN.md "Inbox routing with several agents"): a reply to a message we sent
  // routes to that message's channel; otherwise the currently-listening (or most recently
  // sending) channel; otherwise unrouted, where any `tg recv` may consume it.
  const replyChannel = message.reply_to_message ? ctx.channelForMessage(message.reply_to_message.message_id) : undefined;
  const channel = replyChannel ?? ctx.pickActiveChannel() ?? null;

  ctx.store.addInboxMessage({ id, update_id: null, text, photo_path: photoPath, file_path: filePath, channel });
  ctx.notifyInbox();

  const reaction = ctx.isListening() ? "👀" : "📥";
  await ctx.api.setMessageReaction(String(message.chat.id), message.message_id, reaction);
}

async function downloadAttachment(ctx: HandlerContext, fileId: string, ext: string): Promise<string | null> {
  try {
    const file = await ctx.api.getFile(fileId);
    if (!file.file_path) return null;
    const dir = inboxDir();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const destPath = path.join(dir, `${id}.${ext}`);
    await ctx.api.downloadFile(file.file_path, destPath);
    return destPath;
  } catch {
    return null; // best-effort: the inbox entry still records the text/caption
  }
}
