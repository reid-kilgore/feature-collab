// The standing Tailscale watch (DESIGN.md, "Tailscale re-approval watch"): a periodic probe of each
// laptop pair that sends the check link to Reid once, says when it clears, and never blocks.
// Unit tests drive the state machine with fakes; the daemon test runs the real timer against the ssh stub.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { TailscaleWatcher, parseTailscaleWatchConfig } from "../src/inbox/tailscale-watch.ts";
import type { TailscaleCheckHandle, TailscaleCheckResult } from "../src/inbox/tailscale.ts";
import { setupHarness, sleep, waitForSocketAt, daemonSocketPath } from "./support/harness.ts";

type Sent = { text: string; url?: string };

// A scripted ssh: each call to start() returns the next scripted outcome. `child` lets a test close it.
function fakes() {
  const sent: Sent[] = [];
  const started: Array<{ alias: string; via?: string; killed: boolean; child: EventEmitter & { kill: () => void } }> = [];
  const script: TailscaleCheckResult[] = [];
  let clock = 1_000_000;
  const meta = new Map<string, string>();
  const watcher = (config = { hosts: ["duo"], reverse: [{ via: "duo", target: "mbp" }], intervalSeconds: 600, reminderSeconds: 3600 }) =>
    new TailscaleWatcher({
      startCheck: (alias, opts) => {
        const child = Object.assign(new EventEmitter(), { kill() { entry.killed = true; child.emit("close", null); } });
        const entry = { alias, via: opts?.via, killed: false, child };
        started.push(entry);
        const result = script.shift() ?? { kind: "no-link", detail: "(no output)", exitCode: 255 };
        return { result: Promise.resolve(result), child: child as never } as TailscaleCheckHandle;
      },
      send: async (text, url) => {
        sent.push({ text, url });
      },
      now: () => clock,
      localName: "mbp",
      getMeta: (k) => meta.get(k),
      setMeta: (k, v) => void meta.set(k, v),
      log: () => {},
      config: () => config,
    });
  return { sent, started, script, meta, watcher, advance: (ms: number) => (clock += ms) };
}

const link = (id: string): TailscaleCheckResult => ({ kind: "link", url: `https://login.tailscale.com/a/${id}` });
const ok: TailscaleCheckResult = { kind: "no-link", detail: "(no output)", exitCode: 0 };

test("a healthy pair sends nothing", async () => {
  const f = fakes();
  f.script.push(ok, ok);
  await f.watcher().tick();
  assert.equal(f.sent.length, 0);
  assert.deepEqual(f.started.map((s) => [s.alias, s.via]), [["duo", undefined], ["mbp", "duo"]], "the reverse probe runs through duo");
});

test("a check link is sent once, with the button, and the next tick while the ssh still waits sends nothing", async () => {
  const f = fakes();
  f.script.push(link("aaa111"));
  const w = f.watcher();
  await w.tick();
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0]!.url, "https://login.tailscale.com/a/aaa111");
  assert.match(f.sent[0]!.text, /Tailscale SSH needs approval/);
  assert.match(f.sent[0]!.text, /mbp to duo/);
  f.advance(600_000);
  await w.tick(); // the first ssh is still pending: no new probe, no new message
  assert.equal(f.started.length, 1);
  assert.equal(f.sent.length, 1);
});

test("the reverse direction is not probed while the forward one needs approval", async () => {
  const f = fakes();
  f.script.push(link("aaa111"));
  await f.watcher().tick();
  assert.ok(!f.started.some((s) => s.via), "mbp cannot reach duo, so it cannot ask duo to probe");
});

test("when the waiting ssh exits 0 (approved) Reid is told, and the reverse direction is probed at once", async () => {
  const f = fakes();
  f.script.push(link("aaa111"), link("bbb222"));
  const w = f.watcher();
  await w.tick();
  f.started[0]!.child.emit("close", 0, null);
  await sleep(20);
  assert.equal(f.sent.length, 3, "the first link, the clear notice, and then the reverse link");
  assert.match(f.sent[1]!.text, /works again/);
  assert.match(f.sent[1]!.text, /mbp to duo/);
  assert.equal(f.sent[2]!.url, "https://login.tailscale.com/a/bbb222");
  assert.match(f.sent[2]!.text, /duo to mbp/);
  assert.equal(f.started[1]!.via, "duo");
});

test("an unreachable host is silent, and recovering from silence is silent too", async () => {
  const f = fakes();
  f.script.push({ kind: "no-link", detail: "ssh: connect timed out", exitCode: 255 }, ok, ok);
  const w = f.watcher();
  await w.tick();
  assert.equal(f.sent.length, 0);
  await w.tick();
  assert.equal(f.sent.length, 0, "never had a link, so there is nothing to say 'works again' about");
});

test("a link that expired unapproved is replaced by a fresh one only after the reminder interval", async () => {
  const f = fakes();
  f.script.push(link("aaa111"), link("bbb222"), link("ccc333"));
  const w = f.watcher();
  await w.tick();
  f.started[0]!.child.emit("close", null, "SIGKILL"); // hard-killed, never approved
  f.advance(700_000);
  await w.tick();
  assert.equal(f.sent.length, 1, "within the reminder interval: no second message");
  assert.equal(f.started[1]!.killed, true, "the unseen link's ssh is killed, not left waiting");
  f.advance(3_600_000);
  await w.tick();
  assert.equal(f.sent.length, 2);
  assert.match(f.sent[1]!.text, /Still waiting/);
  assert.equal(f.sent[1]!.url, "https://login.tailscale.com/a/ccc333");
});

test("state survives a restart: a new watcher does not repeat a notice sent a moment ago", async () => {
  const f = fakes();
  f.script.push(link("aaa111"), link("bbb222"));
  await f.watcher().tick();
  f.started[0]!.child.emit("close", null, "SIGKILL");
  f.advance(60_000);
  await f.watcher().tick(); // a fresh instance over the same store
  assert.equal(f.sent.length, 1);
});

test("a host that fails the probe with a thrown error does not stop the others", async () => {
  const f = fakes();
  const w = new TailscaleWatcher({
    startCheck: (alias) => {
      if (alias === "bad") throw new Error("boom");
      return { result: Promise.resolve(link("zzz999")), child: undefined } as TailscaleCheckHandle;
    },
    send: async (text, url) => void f.sent.push({ text, url }),
    now: () => 1,
    localName: "mbp",
    getMeta: () => undefined,
    setMeta: () => {},
    log: () => {},
    config: () => ({ hosts: ["bad", "duo"], reverse: [], intervalSeconds: 600, reminderSeconds: 3600 }),
  });
  await w.tick();
  assert.equal(f.sent.length, 1);
});

test("config: defaults, validation, and unsafe aliases are refused", () => {
  const c = parseTailscaleWatchConfig({ version: 1, hosts: ["duo"] });
  assert.deepEqual(c.hosts, ["duo"]);
  assert.deepEqual(c.reverse, []);
  assert.equal(c.intervalSeconds, 120);
  assert.equal(c.reminderSeconds, 3600);
  assert.equal(parseTailscaleWatchConfig({ version: 1, hosts: ["duo"], reverse: [{ via: "duo", target: "mbp" }], interval: "15m", reminder: "2h" }).intervalSeconds, 900);
  assert.throws(() => parseTailscaleWatchConfig({ version: 1, hosts: ["duo; rm -rf"] }), /host/);
  assert.throws(() => parseTailscaleWatchConfig({ version: 1, hosts: [], reverse: [{ via: "d d", target: "mbp" }] }), /reverse/);
  assert.throws(() => parseTailscaleWatchConfig({ version: 2, hosts: ["duo"] }), /version/);
  assert.throws(() => parseTailscaleWatchConfig({ version: 1, hosts: ["duo"], interval: "0s" }), /interval/);
});

// ---- the real timer, in the daemon, against the ssh stub ----

async function waitUntil(predicate: () => boolean, timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(30);
  }
  throw new Error("condition not met in time");
}

test("the daemon probes on its timer: one link message with an Approve button, then 'works again' when the ssh is approved", async () => {
  const h = await setupHarness({ hostname: "REDD-mason" });
  try {
    writeFileSync(path.join(h.home, "config", "tailscale.json"), JSON.stringify({ version: 1, hosts: ["duo"], interval: "1s", reminder: "1h" }));
    writeFileSync(path.join(h.home, "ssh-output.txt"), "# Tailscale SSH requires an additional check.\n# To authenticate, visit: https://login.tailscale.com/a/watch123\n");
    writeFileSync(path.join(h.home, "ssh-hang"), "");
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));

    const withUrl = () =>
      h.fake.sent.filter((m) => m.method === "sendMessage" && JSON.stringify(m.body.reply_markup ?? {}).includes("login.tailscale.com/a/watch123"));
    await waitUntil(() => withUrl().length >= 1);
    await sleep(2500); // several ticks later: still exactly one message, one ssh
    assert.equal(withUrl().length, 1);
    const calls = readFileSync(path.join(h.home, "ssh-argv.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(calls.length, 1, "no second probe while the first waits");
    assert.deepEqual(calls[0].slice(-2), ["duo", "true"]);
    assert.ok(calls[0].includes("BatchMode=yes"));

    writeFileSync(path.join(h.home, "ssh-release"), ""); // Reid approves; the waiting ssh exits 0
    await waitUntil(() => h.fake.sent.some((m) => m.method === "sendMessage" && String(m.body.text ?? "").includes("works again")));
    assert.match(String(h.fake.sent.find((m) => String(m.body.text ?? "").includes("works again"))!.body.text), /duo/);
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("without tailscale.json the daemon never runs ssh", async () => {
  const h = await setupHarness();
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    await sleep(1500);
    assert.ok(!existsSync(path.join(h.home, "ssh-argv.log")));
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("the daemon probes the reverse direction through the other laptop once the forward one works", async () => {
  const h = await setupHarness();
  try {
    writeFileSync(
      path.join(h.home, "config", "tailscale.json"),
      JSON.stringify({ version: 1, local: "mbp", hosts: ["duo"], reverse: [{ via: "duo", target: "mbp" }], interval: "1s" }),
    );
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    await waitUntil(() => existsSync(path.join(h.home, "ssh-argv.log")) && readFileSync(path.join(h.home, "ssh-argv.log"), "utf8").trim().split("\n").length >= 2);
    const calls = readFileSync(path.join(h.home, "ssh-argv.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(calls[0].slice(-2), ["duo", "true"]);
    assert.deepEqual(calls[1].slice(-2), ["duo", "ssh -o BatchMode=yes -o ConnectTimeout=8 mbp true"]);
    assert.equal(h.fake.sent.filter((m) => m.method === "sendMessage").length, 0, "both directions work: nothing to say");
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("a bad tailscale.json turns the watch off and runs no ssh", async () => {
  const h = await setupHarness();
  try {
    writeFileSync(path.join(h.home, "config", "tailscale.json"), JSON.stringify({ version: 1, hosts: ["duo; rm -rf /"], interval: "1s" }));
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    await sleep(2500);
    assert.ok(!existsSync(path.join(h.home, "ssh-argv.log")));
    assert.match(readFileSync(path.join(h.home, "state", "daemon.log"), "utf8"), /tailscale watch is off: tailscale\.json is invalid/);
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});
