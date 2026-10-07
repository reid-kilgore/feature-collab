// Presence: whether Reid is at a keyboard, as recorded from his own words.
//
// One small file per user, shared by `tg` and `ask-questions` (each has its own copy of this
// reader and they must agree on path and format). Default path ~/.maestro/presence.json;
// MAESTRO_PRESENCE_FILE overrides it; in test mode (AGENT_TELEGRAM_HOME) it lives under that
// directory so a test never touches the real file.
//
// Format (version 1):
//   { "version": 1, "state": "away" | "present", "note": string | null,
//     "setBy": string, "setAt": ISO-8601 (from the clock), "expiresAt": ISO-8601 | null }
// An "away" record past expiresAt reads as present. Reading never rewrites the file.

import { homedir, hostname, userInfo } from "node:os";
import path from "node:path";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isTestMode, stateDir } from "./config.ts";

export type PresenceState = "away" | "present";

export interface PresenceRecord {
  version: 1;
  state: PresenceState;
  note: string | null;
  setBy: string;
  setAt: string;
  expiresAt: string | null;
}

export interface PresenceReading {
  state: PresenceState;
  // Why the state reads as it does: "recorded" (file says so), "expired" (away record past its
  // expiry), "unset" (no usable file).
  reason: "recorded" | "expired" | "unset";
  record: PresenceRecord | null;
}

export const DEFAULT_AWAY_SECONDS = 8 * 3600;

export function presenceFile(): string {
  if (process.env.MAESTRO_PRESENCE_FILE) return process.env.MAESTRO_PRESENCE_FILE;
  if (isTestMode()) return path.join(stateDir(), "presence.json");
  return path.join(homedir(), ".maestro", "presence.json");
}

export function defaultSetBy(): string {
  let user = "unknown";
  try { user = userInfo().username; } catch { /* keep default */ }
  const tmux = process.env.TMUX_PANE ? ` tmux ${process.env.TMUX_PANE}` : "";
  return `${user}@${hostname().split(".")[0]}:${process.cwd()}${tmux}`;
}

export function readPresence(now: Date = new Date(), file: string = presenceFile()): PresenceReading {
  let record: PresenceRecord;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (parsed?.version !== 1 || (parsed.state !== "away" && parsed.state !== "present")) {
      return { state: "present", reason: "unset", record: null };
    }
    record = parsed as PresenceRecord;
  } catch {
    return { state: "present", reason: "unset", record: null };
  }
  if (record.state === "away" && record.expiresAt) {
    const expires = Date.parse(record.expiresAt);
    if (Number.isFinite(expires) && now.getTime() >= expires) return { state: "present", reason: "expired", record };
  }
  return { state: record.state, reason: "recorded", record };
}

export interface SetPresenceOptions {
  state: PresenceState;
  note?: string | null;
  // Seconds from now until an away record expires. null means never. undefined means the default
  // for away (8 hours); present never expires.
  forSeconds?: number | null;
  setBy?: string;
  now?: Date;
  file?: string;
}

export function setPresence(options: SetPresenceOptions): PresenceRecord {
  const now = options.now ?? new Date();
  const file = options.file ?? presenceFile();
  let expiresAt: string | null = null;
  if (options.state === "away") {
    const seconds = options.forSeconds === undefined ? DEFAULT_AWAY_SECONDS : options.forSeconds;
    if (seconds !== null) expiresAt = new Date(now.getTime() + seconds * 1000).toISOString();
  }
  const record: PresenceRecord = {
    version: 1,
    state: options.state,
    note: options.note?.trim() ? options.note.trim() : null,
    setBy: options.setBy?.trim() || defaultSetBy(),
    setAt: now.toISOString(),
    expiresAt,
  };
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`);
  renameSync(tmp, file);
  return record;
}

export function describePresence(reading: PresenceReading): string {
  const { record } = reading;
  if (!record) return "presence: present (no record)";
  const lines = [`presence: ${reading.state}${reading.reason === "expired" ? " (away record expired)" : ""}`];
  lines.push(`  recorded state: ${record.state}, set ${record.setAt} by ${record.setBy}`);
  if (record.note) lines.push(`  note: ${record.note}`);
  lines.push(`  expires: ${record.expiresAt ?? "never"}`);
  return lines.join("\n");
}
