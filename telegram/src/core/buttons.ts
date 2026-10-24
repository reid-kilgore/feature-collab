// URL buttons under a message: parsing "label=url" from the CLI, and finding the one link in a message that
// becomes a button on its own. Only http and https are ever buttons.

import { markdownToTelegramHtml } from "./markdown.ts";

export interface LinkButton {
  text: string;
  url: string;
}

const MAX_LABEL = 40;

function unescapeHtml(text: string): string {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

function shorten(label: string): string {
  return label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label;
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// "Review page=https://example.com/r/1" -> { text, url }. The first "=" that is followed by http(s):// splits
// the two, so a label or a query string may hold "=" itself. Throws a message fit for the user.
export function parseButtonArg(arg: string): LinkButton {
  const at = arg.search(/=https?:\/\//i);
  const text = at > 0 ? arg.slice(0, at).trim() : "";
  const url = at > 0 ? arg.slice(at + 1).trim() : "";
  if (!text || !isHttpUrl(url)) throw new Error(`--button needs "label=url" with an http or https url, got: ${arg}`);
  return { text: shorten(text), url };
}

// The button for a message that holds exactly one distinct http(s) link, or undefined. The link is read from the
// HTML the message renders to, so code spans and code blocks do not count. A [label](url) link gives its label;
// a bare URL gives "Open <host>".
export function singleLinkButton(markdown: string | undefined): LinkButton | undefined {
  if (!markdown) return undefined;
  const html = markdownToTelegramHtml(markdown);
  const found = new Map<string, string>();
  for (const m of html.matchAll(/<a href="([^"]+)">(.*?)<\/a>/g)) {
    const url = unescapeHtml(m[1]!);
    if (!isHttpUrl(url)) continue;
    if (!found.has(url)) found.set(url, unescapeHtml(m[2]!.replace(/<[^>]+>/g, "")).trim());
  }
  if (found.size !== 1) return undefined;
  const [url, label] = [...found][0]!;
  if (label && label !== url) return { text: shorten(label), url };
  return { text: `Open ${new URL(url).hostname.replace(/^www\./, "")}`, url };
}

export function buttonRows(buttons: LinkButton[]): { inline_keyboard: Array<Array<{ text: string; url: string }>> } | undefined {
  return buttons.length ? { inline_keyboard: buttons.map((b) => [{ text: b.text, url: b.url }]) } : undefined;
}

// Runs a send with the buttons; if Telegram refuses a button, runs it again without any, so a bad link never
// sinks the message. Any other failure is thrown as it was.
export async function withButtonFallback<T>(markup: object | undefined, send: (markup: object | undefined) => Promise<T>, log?: (line: string) => void): Promise<T> {
  if (!markup) return send(undefined);
  try {
    return await send(markup);
  } catch (error) {
    if (!isButtonRefusal(error)) throw error;
    log?.(`url button refused (${(error as Error).message}); resending without buttons`);
    return send(undefined);
  }
}

// A refusal of the button itself (for example BUTTON_URL_INVALID for an IP address or localhost).
export function isButtonRefusal(error: unknown): boolean {
  return /button/i.test((error as Error)?.message ?? "");
}
