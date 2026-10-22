// The inquiry log: an append-only JSONL file of what Reid sent, one event per line. It is written
// independently of the SQLite inbox, so a message stays on disk after `tg recv` consumes it and
// can be read, grepped and revived. Only the daemon appends. See DESIGN-dispatcher.md.

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { inquiriesFile } from "../config.ts";
import type { InboxRow } from "./store.ts";

export type InquiryState = "received" | "legacy" | "asked" | "handed_off" | "dropped";

export interface ReceivedEntry {
  op: "received";
  id: string;
  at: string;
  state: InquiryState;
  text: string | null;
  photoPath: string | null;
  filePath: string | null;
  routedTo: string | null;
  tgMessageId?: number | null;
  replyToMessageId?: number | null;
  replyToQuote?: string | null;
  replyToChannel?: string | null;
  inquiry?: string | null;
}

export interface StateEntry {
  op: "state";
  id: string;
  at: string;
  state: InquiryState;
  target?: string;
  ref?: string;
  note?: string;
}

export interface AskedEntry {
  op: "asked";
  id: string;
  at: string;
  tgMessageId: number;
}

export interface RevivedEntry {
  op: "revived";
  id: string;
  at: string;
  // The new inbox row the revived text was put in; the dispatcher sees that id on the message.
  row?: string;
}

export type LogEntry = ReceivedEntry | StateEntry | AskedEntry | RevivedEntry;

export function appendInquiry(entry: LogEntry, file: string = inquiriesFile()): void {
  appendFileSync(file, JSON.stringify(entry) + "\n", { mode: 0o600 });
}

export function entryFromInboxRow(row: InboxRow, state: InquiryState): ReceivedEntry {
  return {
    op: "received",
    id: row.id,
    at: row.at,
    state,
    text: row.text,
    photoPath: row.photo_path,
    filePath: row.file_path,
    routedTo: row.channel,
  };
}

export interface Inquiry {
  id: string;
  at: string;
  state: InquiryState;
  text: string | null;
  photoPath: string | null;
  filePath: string | null;
  routedTo: string | null;
  tgMessageId: number | null;
  replyToQuote: string | null;
  replyToChannel: string | null;
  target?: string;
  ref?: string;
  // Ids of inbox rows made by reviving this inquiry; any of them names the inquiry.
  aliases: string[];
  history: LogEntry[];
}

// Folds the log into one record per inquiry. A malformed line is skipped, never fatal: the file is
// append-only text and may have been edited by hand.
export function readInquiries(file: string = inquiriesFile()): Inquiry[] {
  if (!existsSync(file)) return [];
  const byId = new Map<string, Inquiry>();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let entry: LogEntry;
    try {
      entry = JSON.parse(line) as LogEntry;
    } catch {
      continue;
    }
    if (!entry || typeof entry.id !== "string") continue;
    if (entry.op === "received") {
      const prior = byId.get(entry.id);
      byId.set(entry.id, {
        id: entry.id,
        at: entry.at,
        state: entry.state,
        text: entry.text,
        photoPath: entry.photoPath,
        filePath: entry.filePath,
        routedTo: entry.routedTo,
        tgMessageId: entry.tgMessageId ?? null,
        replyToQuote: entry.replyToQuote ?? null,
        replyToChannel: entry.replyToChannel ?? null,
        aliases: prior?.aliases ?? [],
        history: [...(prior?.history ?? []), entry],
      });
      continue;
    }
    const inquiry = byId.get(entry.id);
    if (!inquiry) continue;
    inquiry.history.push(entry);
    if (entry.op === "state") {
      inquiry.state = entry.state;
      if (entry.target) inquiry.target = entry.target;
      if (entry.ref) inquiry.ref = entry.ref;
    } else if (entry.op === "asked") {
      if (inquiry.state === "received") inquiry.state = "asked";
    } else if (entry.op === "revived") {
      inquiry.state = "received";
      if (entry.row) inquiry.aliases.push(entry.row);
    }
  }
  return [...byId.values()];
}

// Open means it still needs routing: received or asked. legacy, handed_off and dropped are done.
export function isOpen(inquiry: Inquiry): boolean {
  return inquiry.state === "received" || inquiry.state === "asked";
}

export function findInquiry(inquiries: Inquiry[], id: string): Inquiry | undefined {
  return inquiries.find((i) => i.id === id) ?? inquiries.find((i) => i.aliases.includes(id));
}
