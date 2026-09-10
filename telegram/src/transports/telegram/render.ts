// AskPayload question -> Telegram {text, reply_markup}; resolved view; notification view.

import type { Question, AskPayload } from "../../contract/payload.ts";
import type { Level } from "../../contract/notify.ts";
import { LEVEL_PREFIX } from "../../contract/notify.ts";
import { markdownToTelegramHtml } from "../../core/markdown.ts";
import type { InlineKeyboardButton, ReplyMarkup } from "./api.ts";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function truncate(label: string, max = 40): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

// callback_data: q:<shortId>:<action>[:<arg>] - kept well under Telegram's 64-byte limit.
export type CallbackAction = "t" | "s" | "go" | "other" | "skip" | "x";

export function encodeCallback(shortId: string, action: CallbackAction, arg?: number): string {
  const data = arg === undefined ? `q:${shortId}:${action}` : `q:${shortId}:${action}:${arg}`;
  if (Buffer.byteLength(data, "utf8") > 64) throw new Error(`callback_data too long: ${data}`);
  return data;
}

export interface DecodedCallback {
  shortId: string;
  action: CallbackAction;
  arg?: number;
}

export function decodeCallback(data: string): DecodedCallback | undefined {
  const parts = data.split(":");
  if (parts.length < 3 || parts[0] !== "q") return undefined;
  const shortId = parts[1]!;
  const action = parts[2] as CallbackAction;
  if (!["t", "s", "go", "other", "skip", "x"].includes(action)) return undefined;
  const arg = parts[3] !== undefined ? Number(parts[3]) : undefined;
  return { shortId, action, arg };
}

export interface QuestionRenderState {
  shortId: string;
  index: number;
  total: number;
  question: Question;
  selected: string[]; // for "multiple", currently toggled option values
}

export function renderQuestionView(state: QuestionRenderState): { text: string; replyMarkup: ReplyMarkup } {
  const { question, shortId, index, total, selected } = state;
  const header = `<b>Q${index + 1}/${total} — ${escapeHtml(question.prompt)}</b>`;
  const lines = [header];
  if (question.options) {
    for (const option of question.options) {
      const desc = option.description ? ` — ${escapeHtml(option.description)}` : "";
      const star = question.default !== undefined && isDefault(question, option.value) ? " ★" : "";
      lines.push(`• <b>${escapeHtml(option.label)}</b>${desc}${star}`);
    }
  }
  const text = lines.join("\n");

  const rows: InlineKeyboardButton[][] = [];
  if (question.type === "single" && question.options) {
    for (let i = 0; i < question.options.length; i++) {
      const option = question.options[i]!;
      rows.push([{ text: truncate(option.label), callback_data: encodeCallback(shortId, "s", i) }]);
    }
  } else if (question.type === "multiple" && question.options) {
    const shortLabels = question.options.every((o) => o.label.length <= 16);
    const perRow = shortLabels ? 2 : 1;
    let row: InlineKeyboardButton[] = [];
    for (let i = 0; i < question.options.length; i++) {
      const option = question.options[i]!;
      const checked = selected.includes(option.value);
      const box = checked ? "☑" : "☐";
      row.push({ text: truncate(`${box} ${option.label}`), callback_data: encodeCallback(shortId, "t", i) });
      if (row.length === perRow) {
        rows.push(row);
        row = [];
      }
    }
    if (row.length) rows.push(row);
    rows.push([{ text: "✔ Continue", callback_data: encodeCallback(shortId, "go") }]);
  }

  const extras: InlineKeyboardButton[] = [];
  if (question.type !== "text" && question.allowOther !== false) {
    extras.push({ text: "✍️ Other…", callback_data: encodeCallback(shortId, "other") });
  }
  if (question.required === false) {
    extras.push({ text: "⏭ Skip", callback_data: encodeCallback(shortId, "skip") });
  }
  extras.push({ text: "✖ Cancel batch", callback_data: encodeCallback(shortId, "x") });
  if (extras.length) rows.push(extras);

  return { text, replyMarkup: { inline_keyboard: rows } };
}

function isDefault(question: Question, value: string): boolean {
  if (question.type === "multiple") return Array.isArray(question.default) && question.default.includes(value);
  return question.default === value;
}

export function renderForceReplyPrompt(): { text: string; replyMarkup: ReplyMarkup } {
  return { text: "Reply to this message with your answer.", replyMarkup: { force_reply: true, selective: true } };
}

export type ResolvedKind = "answered" | "skipped" | "cancelled" | "expired";

export function renderResolvedView(question: Question, kind: ResolvedKind, answerText?: string): string {
  const prompt = `✅ <b>${escapeHtml(question.prompt)}</b>`;
  if (kind === "answered") return `${prompt}\n<i>${escapeHtml(answerText ?? "")}</i>`;
  if (kind === "skipped") return `${prompt}\n<i>⏭ skipped</i>`;
  if (kind === "cancelled") return `${prompt}\n<i>✖ cancelled</i>`;
  return `${prompt}\n<i>⏰ expired</i>`;
}

export function renderHeader(payload: AskPayload, hostname: string): string | undefined {
  if (!payload.title && !payload.message) return undefined;
  const parts: string[] = [];
  parts.push(`🖥 ${escapeHtml(hostname)}`);
  if (payload.title) parts.push(`📋 <b>${escapeHtml(payload.title)}</b>`);
  if (payload.message) parts.push(markdownToTelegramHtml(payload.message));
  return parts.join("\n");
}

export function renderBatchDone(askerBasename: string, tmuxWindow?: string): string {
  const where = tmuxWindow ? `${askerBasename}, ${tmuxWindow}` : askerBasename;
  return `✅ Answers sent to the agent (${escapeHtml(where)})`;
}

export function renderNotification(
  level: Level,
  hostname: string,
  title: string | undefined,
  bodyHtml: string | undefined,
): string {
  const lines = [`${LEVEL_PREFIX[level]} 🖥 ${escapeHtml(hostname)}`];
  if (title) lines.push(`<b>${escapeHtml(title)}</b>`);
  if (bodyHtml) lines.push(bodyHtml);
  return lines.join("\n");
}
