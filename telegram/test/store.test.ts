import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store, newId, newShortId } from "../src/core/store.ts";

function withStore(fn: (store: Store) => void | Promise<void>): () => Promise<void> {
  return async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "agent-telegram-store-"));
    const store = new Store(path.join(dir, "state.sqlite"));
    try {
      await fn(store);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

test(
  "meta get/set round-trips and upserts",
  withStore((store) => {
    assert.equal(store.getMeta("offset"), undefined);
    store.setMeta("offset", "5");
    assert.equal(store.getMeta("offset"), "5");
    store.setMeta("offset", "6");
    assert.equal(store.getMeta("offset"), "6");
  }),
);

test(
  "batch and question CRUD round-trips",
  withStore((store) => {
    const batchId = newId();
    store.createBatch({
      id: batchId,
      status: "pending",
      asker_path: "/tmp/x",
      asker_tmux_window: "win1",
      payload_json: "{}",
      timeout_at: null,
      on_timeout: "cancel",
      chat_id: "1",
      user_id: "2",
    });
    const batch = store.getBatch(batchId)!;
    assert.equal(batch.status, "pending");
    assert.equal(batch.asker_tmux_window, "win1");

    const shortId = newShortId();
    const questionId = newId();
    store.createQuestion({
      id: questionId,
      batch_id: batchId,
      idx: 0,
      short_id: shortId,
      status: "waiting",
      selected_json: null,
      text_answer: null,
      message_id: null,
      force_reply_message_id: null,
    });
    assert.equal(store.getQuestionByShortId(shortId)?.id, questionId);

    store.updateQuestion(questionId, { status: "pending", message_id: 42 });
    const updated = store.getQuestion(questionId)!;
    assert.equal(updated.status, "pending");
    assert.equal(updated.message_id, 42);

    assert.equal(store.listPendingBatches().length, 1);
    store.updateBatchStatus(batchId, "submitted", JSON.stringify({ ok: true }));
    assert.equal(store.listPendingBatches().length, 0);
    assert.equal(store.getBatch(batchId)!.result_json, JSON.stringify({ ok: true }));
  }),
);

test("opening a pre-channel-routing database adds the missing column and table instead of failing", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "agent-telegram-store-"));
  const dbFile = path.join(dir, "state.sqlite");
  try {
    // Recreate exactly the shape a real daemon on an older build of this code left behind:
    // an `inbox` table that predates the `channel` column, and no `message_channel` table
    // at all. This is what broke the real daemon with "no such column: channel".
    const raw = new DatabaseSync(dbFile);
    raw.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE inbox (
        id TEXT PRIMARY KEY,
        update_id INTEGER,
        at TEXT NOT NULL,
        text TEXT,
        photo_path TEXT,
        file_path TEXT,
        consumed_at TEXT
      );
    `);
    raw.prepare("INSERT INTO inbox (id, update_id, at, text, photo_path, file_path, consumed_at) VALUES (?, ?, ?, ?, ?, ?, NULL)").run(
      "old-message",
      1,
      new Date().toISOString(),
      "a message from before the channel column existed",
      null,
      null,
    );
    raw.close();

    // Opening it through Store must migrate in place, not fail, and must not lose the
    // pre-existing row.
    const store = new Store(dbFile);
    try {
      const rows = store.db.prepare("SELECT id, text, channel FROM inbox").all() as Array<{ id: string; text: string; channel: string | null }>;
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.id, "old-message");
      assert.equal(rows[0]!.channel, null);

      // The new repository methods that read/write `channel` must now work too. The
      // pre-migration row has channel = NULL (unrouted), so it is still visible here
      // alongside the new one, per the "own channel + unrouted" recv rule.
      store.addInboxMessage({ id: "new-message", update_id: 2, text: "after migration", photo_path: null, file_path: null, channel: "chanA" });
      const unread = store.listUnreadInboxForChannel("chanA");
      assert.equal(unread.length, 2);
      assert.ok(unread.some((r) => r.text === "after migration"));

      store.recordMessageChannel(123, "chanA");
      assert.equal(store.getChannelForMessage(123), "chanA");

      assert.equal(store.getMeta("schema_version"), "1");
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  "audit entries accumulate without affecting other tables",
  withStore((store) => {
    store.appendAudit("test_event", null, null, { hello: "world" });
    store.appendAudit("test_event_2", "batch1", "q1", null);
    // No direct getter for audit rows in the repository API; verify via raw query.
    const rows = store.db.prepare("SELECT kind, batch_id, question_id FROM audit ORDER BY seq").all() as Array<{
      kind: string;
      batch_id: string | null;
      question_id: string | null;
    }>;
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.kind, "test_event");
    assert.equal(rows[1]!.batch_id, "batch1");
  }),
);
