// AskPayload question -> Telegram {text, reply_markup}; resolved view; notification view.

import type { Question, AskPayload } from "../../contract/payload.ts";
import type { Level } from "../../contract/notify.ts";
import { markdownToTelegramHtml, markdownInline, splitMessage } from "../../core/markdown.ts";
import type { InlineKeyboardButton, ReplyMarkup } from "./api.ts";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// A, B, ... Z, then AA, AB, ... for the option at a zero-based index.
export function optionLetter(index: number): string {
  let n = index;
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letters;
}

const LETTERS_PER_ROW = 4;

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

// Option buttons show only a letter; the message body lists each letter with its full label and description, so
// nothing is cut at the button width. A body over Telegram's limit is split: `leadTexts` are the earlier parts
// (sent first, with no keyboard) and `text` is the last part, which carries the keyboard and is the one that
// is edited when a choice is toggled.
export function renderQuestionView(state: QuestionRenderState): { text: string; leadTexts: string[]; replyMarkup: ReplyMarkup } {
  const { question, shortId, index, total, selected } = state;
  // The prompt is Markdown too (links, code), but it sits inside a bold header, so its own bold is dropped.
  const header = `<b>Q${index + 1}/${total} — ${markdownInline(question.prompt, { bold: false })}</b>`;
  const lines = [header];
  if (question.options) {
    for (const [i, option] of question.options.entries()) {
      const desc = option.description ? ` — ${markdownInline(option.description)}` : "";
      const star = question.default !== undefined && isDefault(question, option.value) ? " ★" : "";
      lines.push(`<b>${optionLetter(i)}.</b> <b>${escapeHtml(option.label)}</b>${desc}${star}`);
    }
  }
  const parts = splitMessage(lines.join("\n"));
  const text = parts[parts.length - 1]!;
  const leadTexts = parts.slice(0, -1);

  const rows: InlineKeyboardButton[][] = [];
  if (question.type === "single" && question.options) {
    let row: InlineKeyboardButton[] = [];
    for (let i = 0; i < question.options.length; i++) {
      row.push({ text: optionLetter(i), callback_data: encodeCallback(shortId, "s", i) });
      if (row.length === LETTERS_PER_ROW) {
        rows.push(row);
        row = [];
      }
    }
    if (row.length) rows.push(row);
  } else if (question.type === "multiple" && question.options) {
    let row: InlineKeyboardButton[] = [];
    for (let i = 0; i < question.options.length; i++) {
      const checked = selected.includes(question.options[i]!.value);
      const box = checked ? "☑" : "☐";
      row.push({ text: `${box} ${optionLetter(i)}`, callback_data: encodeCallback(shortId, "t", i) });
      if (row.length === LETTERS_PER_ROW) {
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

  return { text, leadTexts, replyMarkup: { inline_keyboard: rows } };
}

function isDefault(question: Question, value: string): boolean {
  if (question.type === "multiple") return Array.isArray(question.default) && question.default.includes(value);
  return question.default === value;
}

export function renderForceReplyPrompt(): { text: string; replyMarkup: ReplyMarkup } {
  return { text: "Reply to this message with your answer.", replyMarkup: { force_reply: true, selective: true } };
}

export type ResolvedKind = "answered" | "skipped" | "cancelled" | "expired";

// An edit over Telegram's 4096-character limit is refused, which would leave a resolved question looking open. So the prompt
// and the answer are clipped (with a "…") until the whole text fits, leaving room for the tags and the words around them.
const FIT = 4000;

// `text` cut, with a "…", so that its escaped form is at most `max` characters; text that already fits is returned as it is.
function clip(text: string, max: number): string {
  if (escapeHtml(text).length <= max) return text;
  let used = 0;
  let out = "";
  for (const ch of text) {
    used += escapeHtml(ch).length;
    if (used > max - 1) break;
    out += ch;
  }
  return `${out}…`;
}

export function renderResolvedView(question: Question, kind: ResolvedKind, answerText?: string): string {
  if (kind === "answered") {
    const answer = clip(answerText ?? "", FIT / 2);
    return `✅ <b>${escapeHtml(clip(question.prompt, FIT - 200 - escapeHtml(answer).length))}</b>\n<i>${escapeHtml(answer)}</i>`;
  }
  const note = kind === "skipped" ? "⏭ skipped" : kind === "cancelled" ? "✖ cancelled" : "⏰ expired";
  return `✅ <b>${escapeHtml(clip(question.prompt, FIT - 200))}</b>\n<i>${note}</i>`;
}

export function renderMovedView(question: Question): string {
  return `↪ <b>${escapeHtml(clip(question.prompt, FIT - 200))}</b>\n<i>moved to the message below</i>`;
}

// askd (ask key askd-...) opens the set on Telegram with its own link and sends from the set's tmux address, which
// is only the asker's pane: it is not shown on those messages (Reid, 2026-11-10).
export function isAskdKey(key: string | null | undefined): boolean {
  return typeof key === "string" && key.startsWith("askd-");
}

export function renderHeader(payload: AskPayload, askerAddress?: string, askKey?: string | null): string | undefined {
  if (!payload.title && !payload.message) return undefined;
  const parts: string[] = [];
  if (payload.title) parts.push(`📋 <b>${escapeHtml(payload.title)}</b>`);
  if (payload.message) parts.push(markdownToTelegramHtml(payload.message));
  if (askerAddress && !isAskdKey(askKey)) parts.push(`<i>${escapeHtml(askerAddress)}</i>`);
  return parts.join("\n");
}

// An askd set marks its intro message done by putting a check mark in front of it, in place of a separate message.
export function renderHeaderDone(headerPart: string): string {
  return `✅ ${headerPart}`;
}

export function renderBatchDone(askerBasename: string, tmuxWindow?: string, askerAddress?: string, askKey?: string | null): string {
  // An askd set has no asker worth naming: its address is only the pane that submitted it.
  if (isAskdKey(askKey)) return "✅ Answers sent to the agent";
  // The address (session:window) says more than the window name alone, so it replaces it.
  const who = askerAddress ?? tmuxWindow;
  const where = who ? `${askerBasename}, ${who}` : askerBasename;
  return `✅ Answers sent to the agent (${escapeHtml(where)})`;
}

// A notification starts with its content. There is no header line: the host is always the machine the
// bot runs on, so naming it says nothing, and an emoji on every message is noise. Only warning and error
// keep one emoji, at the start of the first line, because they should stand out. Who sent it is a small
// italic last line, when the caller knows it.
export function renderNotification(
  level: Level,
  title: string | undefined,
  bodyHtml: string | undefined,
  sender?: string,
): string {
  const lines: string[] = [];
  if (title) lines.push(`<b>${escapeHtml(title)}</b>`);
  if (bodyHtml) lines.push(bodyHtml);
  if (level === "warning" || level === "error") {
    const emoji = level === "warning" ? "⚠️" : "❌";
    if (lines.length === 0) lines.push(emoji);
    else lines[0] = `${emoji} ${lines[0]}`;
  }
  if (sender) lines.push(`<i>${escapeHtml(sender)}</i>`);
  return lines.join("\n");
}
