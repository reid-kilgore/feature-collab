// Question hygiene: a decision key that cancels across channels (tg ask --key, tg cancel --key), the
// pending list with key and sender, and the dispatcher's sweep of questions open for over an hour.

import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { setupHarness, sleep, waitForSocketAt, daemonSocketPath } from "./support/harness.ts";
import type { Harness } from "./support/harness.ts";

const Q = [{ id: "c", prompt: "Colour?", type: "single", options: [{ value: "red", label: "Red" }] }];

async function until(f: () => boolean | Promise<boolean>, ms = 20000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await f()) return;
    await sleep(30);
  }
  throw new Error("condition not met in time");
}

// Starts an ask that stays open; resolves with the process and a getter for its stdout.
async function openAsk(h: Harness, extra: string[], payload: Record<string, unknown> = {}) {
  const proc = h.spawnCli(["ask", ...extra, "--json", JSON.stringify({ version: 1, title: "T", questions: Q, ...payload })]);
  let out = "";
  proc.stdout!.on("data", (c) => (out += c.toString()));
  const closed = new Promise<number | null>((r) => proc.once("close", r));
  await until(async () => (await h.runCli(["pending", "--json"])).stdout.trim() !== "[]" && (await h.runCli(["pending", "--json"])).stdout.includes('"T"'));
  return { proc, out: () => out, closed };
}

async function pendingJson(h: Harness): Promise<Array<Record<string, any>>> {
  return JSON.parse((await h.runCli(["pending", "--json"])).stdout);
}

function db(h: Harness): DatabaseSync {
  return new DatabaseSync(path.join(h.home, "state", "state.sqlite"));
}

test("tg ask --key and a payload key are stored; tg pending shows key and sender; --json has the five fields", async () => {
  const h = await setupHarness();
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    const a = await openAsk(h, ["--from", "ship:geo", "--key", "decision-1"]);
    const rows = await pendingJson(h);
    assert.equal(rows.length, 1);
    assert.deepEqual(Object.keys(rows[0]!).sort(), ["created_at", "id", "key", "sender", "title"]);
    assert.equal(rows[0]!.key, "decision-1");
    assert.equal(rows[0]!.sender, "ship:geo");
    assert.equal(rows[0]!.title, "T");
    const text = (await h.runCli(["pending"])).stdout;
    assert.match(text, /sender ship:geo/);
    assert.match(text, /key decision-1/);
    // a top-level key in the payload; --key wins when both are given
    const b = await openAsk(h, ["--from", "ship:two", "--key", "flag-wins"], { key: "payload-key", title: "T" });
    assert.deepEqual((await pendingJson(h)).map((r) => r.key).sort(), ["decision-1", "flag-wins"]);
    a.proc.kill("SIGKILL");
    b.proc.kill("SIGKILL");
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("a payload key alone is stored, and a blank key is invalid", async () => {
  const h = await setupHarness();
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    const bad = await h.runCli(["ask", "--json", JSON.stringify({ version: 1, key: "", questions: Q })]);
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /key/);
    const a = await openAsk(h, [], { key: "from-payload" });
    assert.equal((await pendingJson(h))[0]!.key, "from-payload");
    a.proc.kill("SIGKILL");
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("tg cancel --key cancels every pending batch with that key, prints the ids, and exits 0 when none match", async () => {
  const h = await setupHarness();
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    const a = await openAsk(h, ["--key", "k1"]);
    const b = await openAsk(h, ["--key", "k1"]);
    const c = await openAsk(h, ["--key", "other"]);
    await until(async () => (await pendingJson(h)).length === 3);
    const before = await pendingJson(h);
    const k1 = before.filter((r) => r.key === "k1").map((r) => r.id).sort();
    const r = await h.runCli(["cancel", "--key", "k1"]);
    assert.equal(r.code, 0);
    assert.deepEqual(JSON.parse(r.stdout).cancelled.sort(), k1);
    await a.closed;
    await b.closed;
    assert.deepEqual((await pendingJson(h)).map((x) => x.key), ["other"]);
    const none = await h.runCli(["cancel", "--key", "nothing"]);
    assert.equal(none.code, 0);
    assert.deepEqual(JSON.parse(none.stdout), { cancelled: [] });
    const usage = await h.runCli(["cancel", "--key"]);
    assert.equal(usage.code, 1);
    const kinds = db(h).prepare("SELECT kind FROM audit WHERE kind = 'batch_cancelled_by_key'").all();
    assert.equal(kinds.length, 2);
    c.proc.kill("SIGKILL");
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("the sweep lists a question open over an hour, not a fresh one, and ping silences it for three hours", async () => {
  const h = await setupHarness();
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    const old = await openAsk(h, ["--from", "ship:geo"], { title: "T" });
    const fresh = await openAsk(h, ["--from", "ship:new"], { title: "T" });
    await until(async () => (await pendingJson(h)).length === 2);
    const rows = await pendingJson(h);
    const oldId = rows.find((r) => r.sender === "ship:geo")!.id;
    const age = (id: string, ms: number) => db(h).prepare("UPDATE batches SET created_at = ? WHERE id = ?").run(new Date(Date.now() - ms).toISOString(), id);
    age(oldId, 61 * 60_000);
    const due = async () => JSON.parse((await h.runCli(["dispatcher", "sweep"])).stdout).due as Array<Record<string, any>>;
    let d = await due();
    assert.deepEqual(d.map((x) => x.id), [oldId]);
    assert.equal(d[0]!.sender, "ship:geo");
    assert.ok(d[0]!.ageMinutes >= 61);

    const ping = await h.runCli(["dispatcher", "sweep", "ping", oldId]);
    assert.equal(ping.code, 0);
    assert.deepEqual(await due(), [], "pinged: quiet");
    // 2h59m after the ping: still quiet; 3h01m: due again
    const setPing = (ms: number) => db(h).prepare("UPDATE audit SET at = ? WHERE kind = 'sweep_ping'").run(new Date(Date.now() - ms).toISOString());
    setPing(179 * 60_000);
    assert.deepEqual(await due(), []);
    setPing(181 * 60_000);
    assert.deepEqual((await due()).map((x) => x.id), [oldId]);

    assert.equal((await h.runCli(["dispatcher", "sweep", "ping", "nonesuch"])).code, 1);
    assert.equal((await h.runCli(["dispatcher", "sweep", "bogus"])).code, 1);
    old.proc.kill("SIGKILL");
    fresh.proc.kill("SIGKILL");
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("sweep cancel cancels the question, tells the user once, and writes audit rows for ping and cancel", async () => {
  const h = await setupHarness();
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    const a = await openAsk(h, ["--from", "gone:win"]);
    const id = (await pendingJson(h))[0]!.id;
    const sentBefore = h.fake.sent.filter((m) => m.method === "sendMessage").length;
    assert.equal((await h.runCli(["dispatcher", "sweep", "ping", id])).code, 0);
    // the first unreachable report only records; a second one under 30 minutes later still does not cancel
    const first = await h.runCli(["dispatcher", "sweep", "cancel", id]);
    assert.equal(first.code, 0, first.stderr);
    assert.equal(JSON.parse(first.stdout).status, "deferred");
    assert.equal(JSON.parse((await h.runCli(["dispatcher", "sweep", "cancel", id])).stdout).status, "deferred");
    assert.equal((await pendingJson(h)).length, 1, "still open");
    assert.equal(h.fake.sent.filter((m) => m.method === "sendMessage" && /Cancelled the open question/.test(String(m.body.text ?? ""))).length, 0, "no notice yet");
    db(h).prepare("UPDATE audit SET at = ? WHERE kind = 'sweep_ping'").run(new Date(Date.now() - 40 * 60_000).toISOString());
    db(h).prepare("UPDATE audit SET at = ? WHERE kind = 'sweep_unreachable'").run(new Date(Date.now() - 31 * 60_000).toISOString());
    const r = await h.runCli(["dispatcher", "sweep", "cancel", id]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { status: "cancelled", id });
    await a.closed;
    assert.deepEqual(await pendingJson(h), []);
    const notices = h.fake.sent.filter((m) => m.method === "sendMessage" && /Cancelled the open question/.test(String(m.body.text ?? "")));
    assert.equal(notices.length, 1);
    assert.ok(h.fake.sent.filter((m) => m.method === "sendMessage").length > sentBefore);
    const kinds = (db(h).prepare("SELECT kind FROM audit WHERE batch_id = ? ORDER BY seq").all(id) as Array<{ kind: string }>).map((x) => x.kind);
    assert.ok(kinds.includes("sweep_ping") && kinds.includes("sweep_cancel"), kinds.join());
    assert.equal((await h.runCli(["dispatcher", "sweep", "cancel", id])).code, 1, "already cancelled");
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("tg dispatcher wait presents each due question as a nudge with ready text and its follow-up commands, not as a separate list", async () => {
  const h = await setupHarness();
  try {
    writeFileSync(
      path.join(h.home, "config", "dispatcher.json"),
      JSON.stringify({ version: 1, channel: "dispatcher", waitTimeout: "2s", defaultTarget: "p", targets: [{ name: "p", description: "x", argv: [process.execPath, "-e", "0"], ack: "ok" }] }),
    );
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    const a = await openAsk(h, ["--from", "ship:geo"]);
    const id = (await pendingJson(h))[0]!.id;
    db(h).prepare("UPDATE batches SET created_at = ? WHERE id = ?").run(new Date(Date.now() - 2 * 3600_000).toISOString(), id);
    const w = await h.runCli(["dispatcher", "wait"]);
    const out = JSON.parse(w.stdout);
    assert.equal(out.status, "timeout");
    assert.equal(out.sweep, undefined, "no separate sweep list");
    assert.equal(out.nudges.length, 1);
    const n = out.nudges[0];
    assert.equal(n.to, "ship:geo");
    assert.equal(n.question, id);
    assert.ok(n.message.includes(id) && n.message.includes(`tg cancel ${id}`) && n.message.includes('"T"'), n.message);
    assert.equal(n.onSent, `tg dispatcher sweep ping ${id}`);
    assert.equal(n.onUnreachable, `tg dispatcher sweep cancel ${id}`);
    const protocol = out.protocol.join(" ");
    for (const needle of ["`nudges`", "rule 4", "SendMessage", "`onSent`", "`onUnreachable`", "three hours", "audit", "not optional"]) {
      assert.ok(protocol.includes(needle), needle);
    }
    // once recorded, the next wake-up carries no nudge for it
    assert.equal((await h.runCli(["dispatcher", "sweep", "ping", id])).code, 0);
    assert.equal(JSON.parse((await h.runCli(["dispatcher", "wait"])).stdout).nudges, undefined);
    a.proc.kill("SIGKILL");
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("the daemon cancels a question with no sender after an hour by itself: one notice, an audit row, no dispatcher action", async () => {
  const h = await setupHarness();
  try {
    h.env.AGENT_TELEGRAM_SWEEP_MS = "150";
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    const orphan = await openAsk(h, ["--from", "x:y"], { title: "T" });
    const keeper = await openAsk(h, ["--from", "keep:me"], { title: "T" });
    const fresh = await openAsk(h, ["--from", "fresh:one"], { title: "T" });
    await until(async () => (await pendingJson(h)).length === 3);
    const rows = await pendingJson(h);
    const idOf = (sender: string) => rows.find((r) => r.sender === sender)!.id as string;
    const orphanId = idOf("x:y");
    const old = new Date(Date.now() - 61 * 60_000).toISOString();
    // the orphan loses its sender (as an older record could); the keeper is old but has one; the fresh one is new
    db(h).prepare("UPDATE batches SET asker_address = NULL, created_at = ? WHERE id = ?").run(old, orphanId);
    db(h).prepare("UPDATE batches SET created_at = ? WHERE id = ?").run(old, idOf("keep:me"));
    db(h).prepare("UPDATE batches SET asker_address = NULL WHERE id = ?").run(idOf("fresh:one"));

    await orphan.closed;
    const pending = await pendingJson(h);
    assert.deepEqual(pending.map((r) => r.id).sort(), [idOf("keep:me"), idOf("fresh:one")].sort());
    await sleep(500); // several more passes: nothing else is touched and the notice is not repeated
    assert.equal((await pendingJson(h)).length, 2);
    const notices = h.fake.sent.filter((m) => m.method === "sendMessage" && String(m.body.text ?? "").includes(orphanId));
    assert.equal(notices.length, 1);
    const audit = db(h).prepare("SELECT kind, detail_json FROM audit WHERE batch_id = ? AND kind = 'sweep_cancel'").all(orphanId) as Array<Record<string, any>>;
    assert.equal(audit.length, 1);
    assert.match(String(audit[0]!.detail_json), /daemon/);
    keeper.proc.kill("SIGKILL");
    fresh.proc.kill("SIGKILL");
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

// The incident shape: a 2-question set, question 1 answered, the sender cannot be found.
const Q2 = [
  { id: "a", prompt: "First?", type: "single", options: [{ value: "x", label: "X" }] },
  { id: "b", prompt: "Second?", type: "single", options: [{ value: "y", label: "Y" }] },
];

function setQuestionStatus(h: Harness, batchId: string, idx: number, status: string): void {
  db(h).prepare("UPDATE questions SET status = ? WHERE batch_id = ? AND idx = ?").run(status, batchId, idx);
}

test("a partly answered set is never listed by the sweep and sweep cancel refuses it, whatever the unreachable count", async () => {
  const h = await setupHarness();
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    const a = await openAsk(h, ["--from", "maestro:maestro"], { questions: Q2 });
    const id = (await pendingJson(h))[0]!.id;
    db(h).prepare("UPDATE batches SET created_at = ? WHERE id = ?").run(new Date(Date.now() - 2 * 3600_000).toISOString(), id);
    const due = async () => JSON.parse((await h.runCli(["dispatcher", "sweep"])).stdout).due as Array<Record<string, any>>;
    assert.deepEqual((await due()).map((x) => x.id), [id], "untouched: due");

    for (const status of ["answered", "skipped", "awaiting_text"]) {
      setQuestionStatus(h, id, 0, status);
      assert.deepEqual(await due(), [], `${status}: not presented`);
      const c = await h.runCli(["dispatcher", "sweep", "cancel", id]);
      assert.equal(c.code, 1, status);
      assert.match(c.stderr, /already answered or skipped/);
      db(h).prepare("UPDATE audit SET at = ? WHERE kind = 'sweep_unreachable'").run(new Date(Date.now() - 5 * 3600_000).toISOString());
      assert.equal((await h.runCli(["dispatcher", "sweep", "cancel", id])).code, 1, `${status}: refused even after two reports`);
    }
    assert.equal((await pendingJson(h)).length, 1, "still open");
    assert.equal(db(h).prepare("SELECT 1 FROM audit WHERE kind = 'sweep_cancel'").all().length, 0);
    a.proc.kill("SIGKILL");
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("the daemon's senderless auto-cancel leaves a partly answered set alone", async () => {
  const h = await setupHarness();
  try {
    h.env.AGENT_TELEGRAM_SWEEP_MS = "150";
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    const a = await openAsk(h, ["--from", "x:y"], { questions: Q2 });
    const id = (await pendingJson(h))[0]!.id;
    setQuestionStatus(h, id, 0, "answered");
    db(h).prepare("UPDATE batches SET asker_address = NULL, created_at = ? WHERE id = ?").run(new Date(Date.now() - 2 * 3600_000).toISOString(), id);
    await sleep(700);
    assert.equal((await pendingJson(h)).length, 1);
    assert.equal(db(h).prepare("SELECT 1 FROM audit WHERE kind = 'sweep_cancel'").all().length, 0);
    a.proc.kill("SIGKILL");
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("an untouched set needs two unreachable reports 30 minutes apart; a ping between them starts the count again", async () => {
  const h = await setupHarness();
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    const a = await openAsk(h, ["--from", "gone:win"], { questions: Q2 });
    const id = (await pendingJson(h))[0]!.id;
    const cancel = async () => JSON.parse((await h.runCli(["dispatcher", "sweep", "cancel", id])).stdout).status as string;
    const ageUnreachable = (ms: number) => {
      db(h).prepare("UPDATE audit SET at = ? WHERE kind = 'sweep_unreachable'").run(new Date(Date.now() - ms).toISOString());
      db(h).prepare("UPDATE audit SET at = ? WHERE kind = 'sweep_ping'").run(new Date(Date.now() - ms - 60_000).toISOString());
    };
    assert.equal(await cancel(), "deferred");
    ageUnreachable(31 * 60_000);
    // the sender answers a later nudge: the earlier report no longer counts
    await sleep(5);
    assert.equal((await h.runCli(["dispatcher", "sweep", "ping", id])).code, 0);
    assert.equal(await cancel(), "deferred", "first report after a ping");
    assert.equal((await pendingJson(h)).length, 1);
    ageUnreachable(31 * 60_000);
    assert.equal(await cancel(), "cancelled");
    await a.closed;
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("tg ask refuses a sender address with no colon, from --from and from the environment, and asks nothing", async () => {
  const h = await setupHarness();
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    const payload = JSON.stringify({ version: 1, title: "T", questions: Q });
    const r = await h.runCli(["ask", "--from", "maestro", "--json", payload]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /SESSION:WINDOW/);
    h.env.AGENT_TELEGRAM_FROM = "maestro";
    const e = await h.runCli(["ask", "--json", payload]);
    assert.equal(e.code, 2);
    assert.deepEqual(await pendingJson(h), []);
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});
