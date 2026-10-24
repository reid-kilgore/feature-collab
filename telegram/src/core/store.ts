// SQLite-backed storage for batches, questions, and audit trail.

import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";

export type BatchStatus = "pending" | "submitted" | "cancelled" | "expired";
export type QuestionStatus =
  | "waiting"
  | "pending"
  | "awaiting_text"
  | "answered"
  | "skipped"
  | "cancelled"
  | "expired";
export type OnTimeout = "cancel" | "default";

export interface BatchRow {
  id: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  status: BatchStatus;
  asker_path: string;
  asker_tmux_window: string | null;
  // session:window (or an address the asker passed): shown in the header and the footer.
  asker_address: string | null;
  // A decision key a caller attaches so the question can be cancelled when the answer is recorded elsewhere.
  ask_key: string | null;
  payload_json: string;
  timeout_at: string | null;
  on_timeout: OnTimeout | null;
  chat_id: string;
  user_id: string;
  result_json: string | null;
}

export interface QuestionRow {
  id: string;
  batch_id: string;
  idx: number;
  short_id: string;
  status: QuestionStatus;
  selected_json: string | null;
  text_answer: string | null;
  message_id: number | null;
  force_reply_message_id: number | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  status TEXT NOT NULL,
  asker_path TEXT NOT NULL,
  asker_tmux_window TEXT,
  asker_address TEXT,
  ask_key TEXT,
  payload_json TEXT NOT NULL,
  timeout_at TEXT,
  on_timeout TEXT,
  chat_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  result_json TEXT
);
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  short_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  selected_json TEXT,
  text_answer TEXT,
  message_id INTEGER,
  force_reply_message_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_questions_batch ON questions(batch_id);
CREATE TABLE IF NOT EXISTS audit (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  batch_id TEXT,
  question_id TEXT,
  detail_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_question ON audit(question_id);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS inbox (
  id TEXT PRIMARY KEY,
  update_id INTEGER,
  at TEXT NOT NULL,
  text TEXT,
  photo_path TEXT,
  file_path TEXT,
  channel TEXT,
  consumed_at TEXT,
  tg_message_id INTEGER,
  reply_to_message_id INTEGER,
  reply_quote TEXT,
  reply_channel TEXT,
  inquiry_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_inbox_unread ON inbox(consumed_at);
CREATE TABLE IF NOT EXISTS message_inquiry (
  message_id INTEGER PRIMARY KEY,
  inquiry_id TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS message_channel (
  message_id INTEGER PRIMARY KEY,
  channel TEXT NOT NULL,
  at TEXT NOT NULL
);
`;

// Schema version, recorded in meta after migrate() brings the database up to date.
// CREATE TABLE IF NOT EXISTS above only fills in tables that are missing outright, which
// is enough for a brand-new database (every table there already has every current
// column) but not for one created by an older build of this code: a table that already
// exists is left exactly as it was, columns and all. migrate() closes that gap by
// explicitly checking for and adding columns/tables introduced after a table's original
// release, so restarting the daemon on an existing state.sqlite never fails with
// "no such column" again.
const CURRENT_SCHEMA_VERSION = 4;

function tableExists(db: DatabaseSync, table: string): boolean {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as
    | { name: string }
    | undefined;
  return Boolean(row);
}

function columnExists(db: DatabaseSync, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

function migrate(db: DatabaseSync): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    // v1: the inbox and channel-routing features (DESIGN.md "Back-and-forth
    // conversation" and "Inbox routing with several agents") added the `channel` column
    // to `inbox` and the whole `message_channel` table. Both checks are idempotent, so
    // this is safe to run against a database at any prior version, known or not.
    if (tableExists(db, "inbox") && !columnExists(db, "inbox", "channel")) {
      db.exec("ALTER TABLE inbox ADD COLUMN channel TEXT");
    }
    if (!tableExists(db, "message_channel")) {
      db.exec(`CREATE TABLE message_channel (
        message_id INTEGER PRIMARY KEY,
        channel TEXT NOT NULL,
        at TEXT NOT NULL
      )`);
    }

    // v2: the dispatcher (DESIGN-dispatcher.md) records, per inbound message, the Telegram message
    // it came from, what it replied to, and the inquiry it belongs to. Additive only: an older
    // build ignores the extra columns and the extra table.
    if (tableExists(db, "inbox")) {
      for (const [column, type] of [
        ["tg_message_id", "INTEGER"],
        ["reply_to_message_id", "INTEGER"],
        ["reply_quote", "TEXT"],
        ["reply_channel", "TEXT"],
        ["inquiry_id", "TEXT"],
      ] as const) {
        if (!columnExists(db, "inbox", column)) db.exec(`ALTER TABLE inbox ADD COLUMN ${column} ${type}`);
      }
    }
    // v3: who is asking, as an address (tmux session:window, or one the caller passed). Additive.
    if (tableExists(db, "batches") && !columnExists(db, "batches", "asker_address")) {
      db.exec("ALTER TABLE batches ADD COLUMN asker_address TEXT");
    }
    // v4: a decision key on a batch, so `tg cancel --key` can cancel across channels. Additive, nullable.
    if (tableExists(db, "batches") && !columnExists(db, "batches", "ask_key")) {
      db.exec("ALTER TABLE batches ADD COLUMN ask_key TEXT");
    }
    if (!tableExists(db, "message_inquiry")) {
      db.exec("CREATE TABLE message_inquiry (message_id INTEGER PRIMARY KEY, inquiry_id TEXT NOT NULL, at TEXT NOT NULL)");
    }

    db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
      String(CURRENT_SCHEMA_VERSION),
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export class Store {
  db: DatabaseSync;

  constructor(dbFile: string) {
    mkdirSync(path.dirname(dbFile), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(dbFile);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec(SCHEMA);
    migrate(this.db);
  }

  close(): void {
    this.db.close();
  }

  // ---- meta ----

  getMeta(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value);
  }

  // ---- audit ----

  appendAudit(kind: string, batchId: string | null, questionId: string | null, detail: unknown): void {
    this.db
      .prepare("INSERT INTO audit (at, kind, batch_id, question_id, detail_json) VALUES (?, ?, ?, ?, ?)")
      .run(new Date().toISOString(), kind, batchId, questionId, JSON.stringify(detail ?? null));
  }

  // ---- batches ----

  createBatch(row: Omit<BatchRow, "created_at" | "updated_at" | "resolved_at" | "result_json" | "asker_address" | "ask_key"> & { asker_address?: string | null; ask_key?: string | null }): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO batches (id, created_at, updated_at, resolved_at, status, asker_path, asker_tmux_window,
          payload_json, timeout_at, on_timeout, chat_id, user_id, result_json, asker_address, ask_key)
         VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      )
      .run(
        row.id,
        now,
        now,
        row.status,
        row.asker_path,
        row.asker_tmux_window,
        row.payload_json,
        row.timeout_at,
        row.on_timeout,
        row.chat_id,
        row.user_id,
        row.asker_address ?? null,
        row.ask_key ?? null,
      );
  }

  getBatch(id: string): BatchRow | undefined {
    return this.db.prepare("SELECT * FROM batches WHERE id = ?").get(id) as unknown as BatchRow | undefined;
  }

  listPendingBatches(): BatchRow[] {
    return this.db.prepare("SELECT * FROM batches WHERE status = 'pending' ORDER BY created_at").all() as unknown as BatchRow[];
  }

  listPendingBatchesByKey(key: string): BatchRow[] {
    return this.db.prepare("SELECT * FROM batches WHERE status = 'pending' AND ask_key = ? ORDER BY created_at").all(key) as unknown as BatchRow[];
  }

  // Sweep (the dispatcher's 30-minute check): pending batches older than `olderThanMs` that were not
  // pinged in the last `quietMs`. A ping is a 'sweep_ping' audit row.
  listSweepDue(olderThanMs: number, quietMs: number, nowMs = Date.now()): BatchRow[] {
    const cutoff = new Date(nowMs - olderThanMs).toISOString();
    const quiet = new Date(nowMs - quietMs).toISOString();
    return this.db
      .prepare(
        `SELECT * FROM batches b WHERE b.status = 'pending' AND b.created_at <= ?
           AND NOT EXISTS (SELECT 1 FROM audit a WHERE a.batch_id = b.id AND a.kind = 'sweep_ping' AND a.at > ?)
         ORDER BY b.created_at`,
      )
      .all(cutoff, quiet) as unknown as BatchRow[];
  }

  // Pending batches older than `olderThanMs` that name no asker: nobody can be asked about them, so the
  // daemon cancels them itself (daemon sweepSenderless).
  listSenderlessStale(olderThanMs: number, nowMs = Date.now()): BatchRow[] {
    const cutoff = new Date(nowMs - olderThanMs).toISOString();
    return this.db
      .prepare("SELECT * FROM batches WHERE status = 'pending' AND created_at <= ? AND (asker_address IS NULL OR TRIM(asker_address) = '') ORDER BY created_at")
      .all(cutoff) as unknown as BatchRow[];
  }

  updateBatchStatus(id: string, status: BatchStatus, resultJson?: string): void {
    const now = new Date().toISOString();
    const resolved = status === "pending" ? null : now;
    this.db
      .prepare("UPDATE batches SET status = ?, updated_at = ?, resolved_at = ?, result_json = COALESCE(?, result_json) WHERE id = ?")
      .run(status, now, resolved, resultJson ?? null, id);
  }

  // ---- questions ----

  createQuestion(row: Omit<QuestionRow, "created_at" | "updated_at" | "resolved_at">): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO questions (id, batch_id, idx, short_id, status, selected_json, text_answer,
          message_id, force_reply_message_id, created_at, updated_at, resolved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        row.id,
        row.batch_id,
        row.idx,
        row.short_id,
        row.status,
        row.selected_json,
        row.text_answer,
        row.message_id,
        row.force_reply_message_id,
        now,
        now,
      );
  }

  getQuestion(id: string): QuestionRow | undefined {
    return this.db.prepare("SELECT * FROM questions WHERE id = ?").get(id) as unknown as QuestionRow | undefined;
  }

  getQuestionByShortId(shortId: string): QuestionRow | undefined {
    return this.db.prepare("SELECT * FROM questions WHERE short_id = ?").get(shortId) as unknown as QuestionRow | undefined;
  }

  listQuestionsForBatch(batchId: string): QuestionRow[] {
    return this.db.prepare("SELECT * FROM questions WHERE batch_id = ? ORDER BY idx").all(batchId) as unknown as QuestionRow[];
  }

  updateQuestion(id: string, fields: Partial<Omit<QuestionRow, "id" | "batch_id" | "idx" | "short_id" | "created_at">>): void {
    const now = new Date().toISOString();
    const current = this.getQuestion(id);
    if (!current) return;
    const merged: QuestionRow = { ...current, ...fields, updated_at: now };
    this.db
      .prepare(
        `UPDATE questions SET status = ?, selected_json = ?, text_answer = ?, message_id = ?,
          force_reply_message_id = ?, updated_at = ?, resolved_at = ? WHERE id = ?`,
      )
      .run(
        merged.status,
        merged.selected_json,
        merged.text_answer,
        merged.message_id,
        merged.force_reply_message_id,
        merged.updated_at,
        merged.resolved_at,
        id,
      );
  }

  // True when `messageId` was this question's chat message before it was moved (reposted) to a
  // newer one. The moves are recorded in the audit trail, so this survives a restart.
  isMovedMessage(questionId: string, messageId: number): boolean {
    const row = this.db
      .prepare("SELECT 1 AS hit FROM audit WHERE kind = 'question_moved' AND question_id = ? AND json_extract(detail_json, '$.from') = ? LIMIT 1")
      .get(questionId, messageId);
    return Boolean(row);
  }

  // The question whose reply prompt `messageId` was before a move, if any.
  questionForMovedForceReply(messageId: number): string | undefined {
    const row = this.db
      .prepare("SELECT question_id FROM audit WHERE kind = 'question_moved' AND json_extract(detail_json, '$.fromForce') = ? LIMIT 1")
      .get(messageId) as { question_id: string } | undefined;
    return row?.question_id;
  }

  // Runs `fn` so that all of its writes happen or none do.
  inTransaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listPendingQuestions(): QuestionRow[] {
    return this.db
      .prepare("SELECT * FROM questions WHERE status IN ('pending', 'awaiting_text') ORDER BY created_at")
      .all() as unknown as QuestionRow[];
  }

  // ---- inbox ----

  addInboxMessage(row: {
    id: string;
    update_id: number | null;
    text: string | null;
    photo_path: string | null;
    file_path: string | null;
    channel: string | null;
    tg_message_id?: number | null;
    reply_to_message_id?: number | null;
    reply_quote?: string | null;
    reply_channel?: string | null;
    inquiry_id?: string | null;
  }): void {
    this.db
      .prepare(
        `INSERT INTO inbox (id, update_id, at, text, photo_path, file_path, channel, consumed_at,
          tg_message_id, reply_to_message_id, reply_quote, reply_channel, inquiry_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.update_id,
        new Date().toISOString(),
        row.text,
        row.photo_path,
        row.file_path,
        row.channel,
        row.tg_message_id ?? null,
        row.reply_to_message_id ?? null,
        row.reply_quote ?? null,
        row.reply_channel ?? null,
        row.inquiry_id ?? null,
      );
  }

  countUnreadForChannel(channel: string): number {
    const row = this.db.prepare("SELECT COUNT(*) as c FROM inbox WHERE consumed_at IS NULL AND channel = ?").get(channel) as { c: number };
    return row.c;
  }

  // ---- message_inquiry (which inquiry a message we sent belongs to) ----

  recordMessageInquiry(messageId: number, inquiryId: string): void {
    this.db
      .prepare("INSERT INTO message_inquiry (message_id, inquiry_id, at) VALUES (?, ?, ?) ON CONFLICT(message_id) DO UPDATE SET inquiry_id = excluded.inquiry_id")
      .run(messageId, inquiryId, new Date().toISOString());
  }

  getInquiryForMessage(messageId: number): string | undefined {
    const row = this.db.prepare("SELECT inquiry_id FROM message_inquiry WHERE message_id = ?").get(messageId) as { inquiry_id: string } | undefined;
    return row?.inquiry_id;
  }

  // Puts an inbox row back in the unread state under `channel` (inquiry revive).
  addRevivedInbox(row: { id: string; text: string | null; photo_path: string | null; file_path: string | null; channel: string; tg_message_id: number | null; inquiry_id: string }): void {
    this.addInboxMessage({ ...row, update_id: null });
  }

  // A channel sees its own routed messages plus anything unrouted (channel IS NULL).
  listUnreadInboxForChannel(channel: string): InboxRow[] {
    return this.db
      .prepare("SELECT * FROM inbox WHERE consumed_at IS NULL AND (channel = ? OR channel IS NULL) ORDER BY at")
      .all(channel) as unknown as InboxRow[];
  }

  // Unread rows with no channel: visible to every `tg recv` caller, whoever listens next.
  listUnroutedUnread(): InboxRow[] {
    return this.db.prepare("SELECT * FROM inbox WHERE consumed_at IS NULL AND channel IS NULL ORDER BY at").all() as unknown as InboxRow[];
  }

  // Unread rows bound to a channel (not NULL) that arrived before `beforeIso`, skipping `exclude`.
  listUnreadOnChannelsBefore(beforeIso: string, exclude: string[]): InboxRow[] {
    const rows = this.db
      .prepare("SELECT * FROM inbox WHERE consumed_at IS NULL AND channel IS NOT NULL AND at < ? ORDER BY at")
      .all(beforeIso) as unknown as InboxRow[];
    return rows.filter((r) => !exclude.includes(r.channel!));
  }

  countUnreadInbox(): number {
    const row = this.db.prepare("SELECT COUNT(*) as c FROM inbox WHERE consumed_at IS NULL").get() as { c: number };
    return row.c;
  }

  countUnreadInboxByChannel(): Array<{ channel: string; count: number }> {
    return this.db
      .prepare("SELECT COALESCE(channel, '(unrouted)') as channel, COUNT(*) as count FROM inbox WHERE consumed_at IS NULL GROUP BY channel")
      .all() as unknown as Array<{ channel: string; count: number }>;
  }

  consumeInbox(ids: string[]): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare("UPDATE inbox SET consumed_at = ? WHERE id = ?");
    for (const id of ids) stmt.run(now, id);
  }

  // ---- message_channel (reply-to routing for tg send) ----

  recordMessageChannel(messageId: number, channel: string): void {
    this.db
      .prepare("INSERT INTO message_channel (message_id, channel, at) VALUES (?, ?, ?) ON CONFLICT(message_id) DO UPDATE SET channel = excluded.channel")
      .run(messageId, channel, new Date().toISOString());
  }

  getChannelForMessage(messageId: number): string | undefined {
    const row = this.db.prepare("SELECT channel FROM message_channel WHERE message_id = ?").get(messageId) as { channel: string } | undefined;
    return row?.channel;
  }
}

export interface InboxRow {
  id: string;
  update_id: number | null;
  at: string;
  text: string | null;
  photo_path: string | null;
  file_path: string | null;
  channel: string | null;
  consumed_at: string | null;
  tg_message_id: number | null;
  reply_to_message_id: number | null;
  reply_quote: string | null;
  reply_channel: string | null;
  inquiry_id: string | null;
}

export function newId(): string {
  return randomBytes(12).toString("hex");
}

export function newShortId(): string {
  // 10 chars, base36 alphabet - short, URL/callback_data-safe, ample entropy for one bot's
  // concurrent questions.
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(10);
  let out = "";
  for (let i = 0; i < 10; i++) out += alphabet[bytes[i]! % alphabet.length];
  return out;
}
