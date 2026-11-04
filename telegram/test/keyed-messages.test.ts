// tg send --key / tg resolve --key: a message sent under a key is deleted later (edited to "Resolved." when
// Telegram refuses), with an audit row, and resolving an unknown or already-resolved key does nothing. The
// Tailscale watch resolves its own link notice when the pair probes OK.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../src/core/store.ts";
import { resolveKeyedMessages } from "../src/core/keyed-messages.ts";
import { TailscaleWatcher } from "../src/inbox/tailscale-watch.ts";
import type { TailscaleCheckHandle, TailscaleCheckResult } from "../src/inbox/tailscale.ts";
import { setupHarness, sleep, waitForSocketAt, daemonSocketPath } from "./support/harness.ts";

function makeStore() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "agent-telegram-test-"));
  return { store: new Store(path.join(dir, "state.sqlite")), dir };
}

test("resolve deletes each open message under the key once, and an unknown or resolved key does nothing", async () => {
  const { store, dir } = makeStore();
  store.recordKeyedMessage("aws-ABCD", 11);
  store.recordKeyedMessage("aws-ABCD", 12);
  store.recordKeyedMessage("other", 13);
  const deleted: number[] = [];
  const ops = {
    async tryDelete(_c: string, m: number) {
      deleted.push(m);
      return true as const;
    },
    async edit() {
      throw new Error("must not edit");
    },
  };
  assert.deepEqual(await resolveKeyedMessages(store, ops, "1", "aws-ABCD"), { deleted: 2, edited: 0 });
  assert.deepEqual(deleted, [11, 12]);
  assert.deepEqual(await resolveKeyedMessages(store, ops, "1", "aws-ABCD"), { deleted: 0, edited: 0 });
  assert.deepEqual(await resolveKeyedMessages(store, ops, "1", "never-sent"), { deleted: 0, edited: 0 });
  assert.deepEqual(deleted, [11, 12], "nothing else was touched");
  const kinds = store.db.prepare("SELECT kind FROM audit").all() as Array<{ kind: string }>;
  assert.deepEqual(kinds.map((r) => r.kind), ["keyed_message_deleted", "keyed_message_deleted"]);
  rmSync(dir, { recursive: true, force: true });
});

test("when Telegram refuses the delete the message is edited to Resolved., and the audit row says so", async () => {
  const { store, dir } = makeStore();
  store.recordKeyedMessage("k", 5);
  const edits: Array<[number, string]> = [];
  const ops = {
    async tryDelete() {
      return { error: "Bad Request: message can't be deleted" };
    },
    async edit(_c: string, m: number, text: string) {
      edits.push([m, text]);
    },
  };
  assert.deepEqual(await resolveKeyedMessages(store, ops, "1", "k"), { deleted: 0, edited: 1 });
  assert.deepEqual(edits, [[5, "Resolved."]]);
  const row = store.db.prepare("SELECT kind, detail_json AS d FROM audit").get() as { kind: string; d: string };
  assert.equal(row.kind, "keyed_message_delete_fell_back");
  assert.deepEqual(JSON.parse(row.d), { key: "k", message_id: 5, error: "Bad Request: message can't be deleted", edit_error: null });
  assert.deepEqual(store.listOpenKeyedMessages("k"), [], "it is not retried");
  rmSync(dir, { recursive: true, force: true });
});

test("the Tailscale watch keys its link notice and resolves it when the pair probes OK", async () => {
  const sent: Array<{ text: string; key?: string }> = [];
  const resolved: string[] = [];
  const script: TailscaleCheckResult[] = [
    { kind: "link", url: "https://login.tailscale.com/a/aaa111" },
    { kind: "no-link", detail: "(no output)", exitCode: 0 },
  ];
  const meta = new Map<string, string>();
  const watcher = new TailscaleWatcher({
    startCheck: () => {
      const child = Object.assign(new EventEmitter(), { kill() {} });
      return { result: Promise.resolve(script.shift()!), child: child as never } as TailscaleCheckHandle;
    },
    send: async (text, _url, key) => void sent.push({ text, key }),
    resolve: async (key) => void resolved.push(key),
    now: () => 1_000_000,
    localName: "mbp",
    getMeta: (k) => meta.get(k),
    setMeta: (k, v) => void meta.set(k, v),
    log: () => {},
    config: () => ({ hosts: ["duo"], reverse: [], intervalSeconds: 600, reminderSeconds: 3600 }),
  });
  await watcher.tick();
  assert.equal(sent[0]!.key, "tailscale-link:duo");
  assert.deepEqual(resolved, [], "still waiting for approval");
  await watcher.tick();
  assert.deepEqual(resolved, ["tailscale-link:duo"]);
  assert.match(sent[1]!.text, /works again/);
  assert.equal(sent[1]!.key, undefined, "the status line is not a link notice");
});

test("tg send --key then tg resolve --key deletes the message through the daemon; help acts on nothing", async () => {
  const h = await setupHarness();
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    const send = await h.runCli(["send", "--key", "aws-ABCD", "log in at https://example.com/device code ABCD"]);
    assert.equal(send.code, 0);
    const messageId = h.fake.sent.find((m) => m.method === "sendMessage")!.messageId!;
    const help = await h.runCli(["resolve", "--help"]);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /Usage: tg resolve --key KEY/);
    assert.equal(h.fake.sent.filter((m) => m.method === "deleteMessage").length, 0, "help deleted nothing");
    assert.equal((await h.runCli(["resolve"])).code, 1);
    const r = await h.runCli(["resolve", "--key", "aws-ABCD"]);
    assert.equal(r.code, 0);
    assert.deepEqual(JSON.parse(r.stdout), { deleted: 1, edited: 0 });
    const deletes = h.fake.sent.filter((m) => m.method === "deleteMessage");
    assert.equal(deletes.length, 1);
    assert.equal(deletes[0]!.body.message_id, messageId);
    const again = await h.runCli(["resolve", "--key", "aws-ABCD"]);
    assert.deepEqual(JSON.parse(again.stdout), { deleted: 0, edited: 0 });
    const unknown = await h.runCli(["resolve", "--key", "nothing"]);
    assert.equal(unknown.code, 0);
    assert.equal(h.fake.sent.filter((m) => m.method === "deleteMessage").length, 1);
    await sleep(10);
    const db = new DatabaseSync(path.join(h.home, "state", "state.sqlite"));
    const kinds = (db.prepare("SELECT kind FROM audit WHERE kind LIKE 'keyed_message%'").all() as Array<{ kind: string }>).map((x) => x.kind);
    assert.deepEqual(kinds, ["keyed_message_deleted"]);
    db.close();
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});
