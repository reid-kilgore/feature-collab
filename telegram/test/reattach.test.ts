// A daemon restart must never make a waiting `tg ask` or `tg wait` look like success. They re-attach on their
// own for a few minutes (the question is stored, so the answer still arrives). If they cannot, they exit 3
// with the batch id and the exact command to run, and print nothing on stdout.

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupHarness, sleep, waitForSocketAt, daemonSocketPath } from "./support/harness.ts";
import type { Harness } from "./support/harness.ts";

function shortId(msg: any): string | undefined {
  for (const row of msg?.body.reply_markup?.inline_keyboard ?? []) {
    for (const b of row) {
      const p = String(b.callback_data ?? "").split(":");
      if (p[0] === "q" && p[2] === "s") return p[1];
    }
  }
}

async function until(f: () => boolean, ms = 20000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (f()) return;
    await sleep(30);
  }
  throw new Error("condition not met in time");
}

const PAYLOAD = { version: 1, questions: [{ id: "q1", prompt: "Pick one", type: "single", options: [{ value: "a", label: "A" }] }] };

function tuned(h: Harness, limitMs: number): void {
  h.env.AGENT_TELEGRAM_NO_AUTOSTART = "1"; // the test owns every daemon
  h.env.AGENT_TELEGRAM_RECONNECT_MS = String(limitMs);
  h.env.AGENT_TELEGRAM_RECONNECT_BASE_MS = "100";
  h.env.AGENT_TELEGRAM_CONNECT_MS = "400";
}

async function startAsk(h: Harness) {
  const ask = h.spawnCli(["ask", "--json", JSON.stringify(PAYLOAD)]);
  let out = "";
  let err = "";
  ask.stdout!.on("data", (c) => (out += c));
  ask.stderr!.on("data", (c) => (err += c));
  const closed = new Promise<number | null>((r) => ask.once("close", r));
  await until(() => h.fake.sent.some((m) => m.method === "sendMessage" && shortId(m)));
  await until(() => /Question id: /.test(err));
  return { ask, closed, out: () => out, err: () => err, id: /Question id: (\S+)/.exec(err)![1]!, sid: shortId(h.fake.sent.find((m) => shortId(m))!)! };
}

test("tg ask survives a daemon restart: it re-attaches and prints the answer once it is given", async () => {
  const h = await setupHarness();
  try {
    tuned(h, 60000);
    const d1 = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    const a = await startAsk(h);
    d1.kill("SIGTERM"); // what a launchd restart sends
    await new Promise((r) => d1.once("close", r)); // launchd starts the new daemon after the old one exits
    const d2 = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    await sleep(300);
    h.fake.pushCallback({ chatId: Number(h.chatId), userId: Number(h.userId), data: `q:${a.sid}:s:0` });
    const code = await Promise.race([a.closed, sleep(8000).then(() => "TIMEOUT")]);
    assert.equal(code, 0, `exit ${code}; stderr: ${a.err()}; stdout: ${a.out()}`);
    const result = JSON.parse(a.out().trim());
    assert.equal(result.status, "submitted");
    assert.equal(result.answers.q1.value, "a");
    d2.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("tg ask that cannot get the daemon back exits 3 with the id and the command, and nothing on stdout", async () => {
  const h = await setupHarness();
  try {
    tuned(h, 1500);
    const d1 = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    const a = await startAsk(h);
    d1.kill("SIGKILL");
    assert.equal(await a.closed, 3);
    assert.equal(a.out().trim(), "", "a failure prints no result");
    assert.match(a.err(), /the daemon went away; the question is still open/);
    assert.ok(a.err().includes(`tg wait ${a.id}`), a.err());
  } finally {
    await h.teardown();
  }
});

test("tg wait survives a daemon restart too", async () => {
  const h = await setupHarness();
  try {
    tuned(h, 60000);
    const d1 = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    const a = await startAsk(h);
    // The asker stays attached (killing it would cancel the set); a second process also waits for the answer.
    const w = h.spawnCli(["wait", a.id]);
    let wout = "";
    w.stdout!.on("data", (c) => (wout += c));
    const wClosed = new Promise<number | null>((r) => w.once("close", r));
    await sleep(500);
    d1.kill("SIGTERM");
    await new Promise((r) => d1.once("close", r));
    const d2 = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    await sleep(300);
    h.fake.pushCallback({ chatId: Number(h.chatId), userId: Number(h.userId), data: `q:${a.sid}:s:0` });
    assert.equal(await wClosed, 0);
    assert.equal(JSON.parse(wout.trim()).answers.q1.value, "a");
    assert.equal(await a.closed, 0, "the asker re-attached too");
    d2.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("tg wait that cannot get the daemon back exits 3 with the command to run", async () => {
  const h = await setupHarness();
  try {
    tuned(h, 1500);
    const d1 = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    const a = await startAsk(h);
    const w = h.spawnCli(["wait", a.id]);
    let wout = "";
    let werr = "";
    w.stdout!.on("data", (c) => (wout += c));
    w.stderr!.on("data", (c) => (werr += c));
    const wClosed = new Promise<number | null>((r) => w.once("close", r));
    await sleep(500);
    d1.kill("SIGKILL");
    assert.equal(await wClosed, 3);
    assert.equal(wout.trim(), "");
    assert.ok(werr.includes(`tg wait ${a.id}`), werr);
    await a.closed;
  } finally {
    await h.teardown();
  }
});

test("tg wait for an id the daemon does not know fails at once and is not retried", async () => {
  const h = await setupHarness();
  try {
    tuned(h, 60000);
    const d = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    const started = Date.now();
    const r = await h.runCli(["wait", "nosuchbatch"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /unknown batch/);
    assert.ok(Date.now() - started < 5000);
    d.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("a question that was already resolved before tg wait connects answers at once", async () => {
  const h = await setupHarness();
  try {
    tuned(h, 60000);
    const d = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    const a = await startAsk(h);
    h.fake.pushCallback({ chatId: Number(h.chatId), userId: Number(h.userId), data: `q:${a.sid}:s:0` });
    await a.closed; // answered; the result is stored
    const r = await h.runCli(["wait", a.id]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout.trim()).status, "submitted");
    d.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});
