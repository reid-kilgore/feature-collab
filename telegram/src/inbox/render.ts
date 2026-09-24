// Renders maestro inbox items for Telegram: the /inbox list (one line + button per item)
// and the per-item detail view (full text plus its trail) shown when a button is tapped.

import type { InlineKeyboardButton, ReplyMarkup } from "../transports/telegram/api.ts";
import type { MaestroItem } from "./maestro.ts";
import { parseUnreachableAlias } from "./tailscale.ts";

const TELEGRAM_MESSAGE_LIMIT = 4096;
const MAX_LIST_BUTTONS = 10;

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function truncate(label: string, max: number): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

const STATE_ICON: Record<string, string> = {
  open: "🆕",
  taken: "🔧",
  done: "✅",
  parked: "⏸",
};

function stateIcon(state: string): string {
  return STATE_ICON[state] ?? "❔";
}

// Compact age, for the /inbox list line (no "ago" suffix there — "5m", "3h", "2d").
function ageLabel(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "?";
  const ms = Date.now() - then;
  if (ms < 60_000) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

// Same age, phrased for the detail view's "by X · <age>" and trail lines. "just now" already
// reads correctly on its own, so it does not also get "ago" tacked on ("just now ago" would).
function ageAgo(iso: string): string {
  const label = ageLabel(iso);
  return label === "just now" ? label : `${label} ago`;
}

const CALLBACK_PREFIX = "ibx:";

// callback_data: ibx:<id> - ids like "duo:a3" fit comfortably under Telegram's 64-byte limit.
export function encodeInboxCallback(id: string): string {
  const data = `${CALLBACK_PREFIX}${id}`;
  if (Buffer.byteLength(data, "utf8") > 64) throw new Error(`callback_data too long: ${data}`);
  return data;
}

export function decodeInboxCallback(data: string): string | undefined {
  if (!data.startsWith(CALLBACK_PREFIX)) return undefined;
  const id = data.slice(CALLBACK_PREFIX.length);
  return id || undefined;
}

export function renderInboxList(items: MaestroItem[], warnings: string[]): { text: string; replyMarkup: ReplyMarkup } {
  const lines: string[] = [];
  const rows: InlineKeyboardButton[][] = [];

  if (items.length === 0) {
    lines.push("No items from you in the last 48 hours.");
  } else {
    const shown = items.slice(0, MAX_LIST_BUTTONS);
    shown.forEach((item, i) => {
      const snippet = truncate(item.text.replace(/\s+/g, " ").trim(), 60);
      lines.push(`${i + 1}. ${stateIcon(item.state)} <b>${escapeHtml(item.id)}</b> · ${ageLabel(item.at)} — ${escapeHtml(snippet)}`);
      rows.push([{ text: `${i + 1}. ${item.id}`, callback_data: encodeInboxCallback(item.id) }]);
    });
    if (items.length > shown.length) lines.push(`…and ${items.length - shown.length} more (not shown)`);
  }

  for (const warning of warnings) {
    const alias = parseUnreachableAlias(warning);
    lines.push(alias ? `⚠️ ${escapeHtml(alias)} unreachable — Tailscale may need a check` : `⚠️ ${escapeHtml(warning)}`);
  }

  return { text: lines.join("\n"), replyMarkup: { inline_keyboard: rows } };
}

export function renderInboxDetail(item: MaestroItem): string {
  const lines: string[] = [];
  lines.push(`${stateIcon(item.state)} <b>${escapeHtml(item.id)}</b> [${escapeHtml(item.kind)}] ${escapeHtml(item.state)}`);
  lines.push(`by ${escapeHtml(item.by)} · ${ageAgo(item.at)}`);
  if (item.ref) lines.push(`ref: ${escapeHtml(item.ref)}`);
  lines.push("");
  lines.push(escapeHtml(item.text));

  if (item.trail.length) {
    lines.push("");
    lines.push("<b>Trail</b>");
    for (const entry of item.trail) {
      lines.push(`<i>${escapeHtml(entry.by)} · ${escapeHtml(entry.op)} · ${ageAgo(entry.at)}</i>`);
      lines.push(escapeHtml(entry.text));
    }
  }

  return truncateForTelegram(lines.join("\n"));
}

// Truncates at a line boundary (every line above is a self-contained, already-closed HTML
// span) so we never cut an <a>/<b>/<i> tag in half.
function truncateForTelegram(text: string, max: number = TELEGRAM_MESSAGE_LIMIT): string {
  if (text.length <= max) return text;
  const suffix = "\n… (truncated)";
  const budget = max - suffix.length;
  const lines = text.split("\n");
  let out = "";
  for (const line of lines) {
    const next = out ? `${out}\n${line}` : line;
    if (next.length > budget) break;
    out = next;
  }
  return `${out}${suffix}`;
}
