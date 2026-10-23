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

test("tg dispatcher wait carries the sweep list on its wake-up, and the protocol tells the dispatcher what to do with it", async () => {
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
    assert.deepEqual(out.sweep.map((x: any) => x.id), [id]);
    const protocol = out.protocol.join(" ");
    for (const needle of ["tg cancel <id>", "ssh <daemon-host> tg cancel <id>", "tg dispatcher sweep ping <id>", "tg dispatcher sweep cancel <id>", "three hours", "audit"]) {
      assert.ok(protocol.includes(needle), needle);
    }
    a.proc.kill("SIGKILL");
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});
