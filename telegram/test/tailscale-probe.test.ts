// The watch must be fast, and it must be observable: every probe and every state change is logged with its
// result, the last probe time and result per direction are kept and shown in `tg status`, and a probe that
// neither prints a link nor exits must not stall its pair (a stuck probe once kept a pair unwatched for the
// whole kill timer, so a block that began and ended between two ticks was never reported).

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { TailscaleWatcher, parseTailscaleWatchConfig, describeWatchState } from "../src/inbox/tailscale-watch.ts";
import type { TailscaleCheckHandle, TailscaleCheckResult } from "../src/inbox/tailscale.ts";
import { setupHarness, sleep, waitForSocketAt, daemonSocketPath } from "./support/harness.ts";

function rig(config = { hosts: ["duo"], reverse: [{ via: "duo", target: "mbp" }], intervalSeconds: 120, reminderSeconds: 3600 }) {
  const sent: Array<{ text: string; url?: string }> = [];
  const logs: string[] = [];
  const kills: string[] = [];
  const script: Array<TailscaleCheckResult | "hang"> = [];
  const meta = new Map<string, string>();
  let clock = Date.parse("2026-10-23T12:00:00Z");
  const children: EventEmitter[] = [];
  const watcher = new TailscaleWatcher({
    startCheck: (alias, opts) => {
      const key = opts?.via ? `${opts.via}>${alias}` : alias;
      const child = Object.assign(new EventEmitter(), { kill() { kills.push(key); child.emit("close", null, "SIGKILL"); } });
      children.push(child);
      const next = script.shift() ?? ({ kind: "no-link", detail: "(no output)", exitCode: 0 } as TailscaleCheckResult);
      // "hang": ssh printed nothing and did not exit before the watch window ended.
      const result: TailscaleCheckResult = next === "hang" ? { kind: "no-link", detail: "(no output)" } : next;
      // A real ssh that is not waiting for an approval exits as soon as it has its answer.
      if (result.kind === "no-link" && result.exitCode !== undefined) queueMicrotask(() => child.emit("close", result.exitCode, null));
      return { result: Promise.resolve(result), child: child as never } as TailscaleCheckHandle;
    },
    send: async (text, url) => void sent.push({ text, url }),
    now: () => clock,
    localName: "mbp",
    getMeta: (k) => meta.get(k),
    setMeta: (k, v) => void meta.set(k, v),
    log: (l) => logs.push(l),
    config: () => config,
  });
  return { watcher, sent, logs, kills, script, meta, children, advance: (ms: number) => (clock += ms) };
}

const ok: TailscaleCheckResult = { kind: "no-link", detail: "(no output)", exitCode: 0 };
const link = (id: string): TailscaleCheckResult => ({ kind: "link", url: `https://login.tailscale.com/a/${id}` });

test("the default probe interval is 2 minutes, and it stays configurable", () => {
  assert.equal(parseTailscaleWatchConfig({ version: 1, hosts: ["duo"] }).intervalSeconds, 120);
  assert.equal(parseTailscaleWatchConfig({ version: 1, hosts: ["duo"], interval: "30s" }).intervalSeconds, 30);
});

test("every probe is logged with its pair and result, even when nothing is wrong", async () => {
  const r = rig();
  r.script.push(ok, ok);
  await r.watcher.tick();
  const lines = r.logs.filter((l) => l.startsWith("tailscale probe"));
  assert.equal(lines.length, 2);
  assert.match(lines[0]!, /tailscale probe mbp to duo: ok/);
  assert.match(lines[1]!, /tailscale probe duo to mbp: ok/);
});

test("a state change is logged on its own line, with the old and the new state", async () => {
  const r = rig();
  r.script.push(link("aaa111"));
  await r.watcher.tick();
  assert.ok(r.logs.some((l) => /tailscale state mbp to duo: ok -> needs_check/.test(l)), r.logs.join("\n"));
  assert.ok(r.logs.some((l) => /link sent/.test(l)));
});

test("the last probe time and result are stored per direction, and read back by describeWatchState", async () => {
  const r = rig();
  r.script.push(ok, ok);
  await r.watcher.tick();
  const forward = JSON.parse(r.meta.get("tsw:duo")!);
  assert.equal(forward.lastProbeAt, "2026-10-23T12:00:00.000Z");
  assert.equal(forward.lastResult, "ok");
  assert.ok(JSON.parse(r.meta.get("tsw:duo>mbp")!).lastProbeAt);
  const rows = describeWatchState((k) => r.meta.get(k), ["duo"], [{ via: "duo", target: "mbp" }], "mbp", Date.parse("2026-10-23T12:01:00Z"));
  assert.deepEqual(rows.map((x) => [x.pair, x.state, x.lastResult, x.ageSeconds]), [
    ["mbp to duo", "ok", "ok", 60],
    ["duo to mbp", "ok", "ok", 60],
  ]);
});

test("a pair never probed reads as 'not probed yet'", () => {
  const rows = describeWatchState(() => undefined, ["duo"], [], "mbp", 0);
  assert.deepEqual(rows.map((x) => [x.pair, x.lastResult, x.ageSeconds]), [["mbp to duo", "not probed yet", null]]);
});

test("a probe that prints no link and does not exit is killed and does not stall its pair", async () => {
  const r = rig();
  r.script.push("hang", ok, ok);
  await r.watcher.tick();
  assert.deepEqual(r.kills, ["duo"], "the hung ssh is killed, not left running for the kill timer");
  assert.ok(r.logs.some((l) => /tailscale probe mbp to duo: hung/.test(l)));
  r.advance(120_000);
  await r.watcher.tick();
  const probes = r.logs.filter((l) => /tailscale probe mbp to duo/.test(l));
  assert.equal(probes.length, 2, "the next tick probes the pair again instead of skipping it");
  assert.match(probes[1]!, /ok/);
});

test("two hung probes in a row tell the user once, and a success says it answers again and re-arms", async () => {
  const r = rig();
  r.script.push("hang", "hang", "hang", ok, ok, "hang", "hang");
  const w = r.watcher;
  await w.tick();
  assert.equal(r.sent.length, 0, "one hang is not worth a message");
  r.advance(120_000);
  await w.tick();
  assert.equal(r.sent.length, 1);
  assert.match(r.sent[0]!.text, /does not answer/i);
  assert.match(r.sent[0]!.text, /mbp to duo/);
  r.advance(120_000);
  await w.tick();
  assert.equal(r.sent.length, 1, "not repeated while it keeps hanging");
  r.advance(120_000);
  await w.tick(); // forward ok, reverse ok
  assert.match(r.sent[1]!.text, /answers again/);
  r.advance(120_000);
  await w.tick(); // hang once more: counted from zero again, no message yet
  assert.equal(r.sent.length, 2);
  r.advance(120_000);
  await w.tick();
  assert.equal(r.sent.length, 3, "a new outage is announced again");
});

test("a block that begins and ends between two ticks is still seen by the tick that overlaps it", async () => {
  const r = rig();
  r.script.push(ok, ok, link("zzz999"), ok);
  await r.watcher.tick();
  r.advance(120_000);
  await r.watcher.tick(); // forward shows a check link
  assert.equal(r.sent.filter((s) => s.url).length, 1);
});

test("tg status shows the watch, with the last probe age per direction", async () => {
  const h = await setupHarness();
  try {
    writeFileSync(path.join(h.home, "config", "tailscale.json"), JSON.stringify({ version: 1, local: "mbp", hosts: ["duo"], reverse: [{ via: "duo", target: "mbp" }], interval: "1s" }));
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    const deadline = Date.now() + 20000;
    let out = "";
    while (Date.now() < deadline) {
      out = (await h.runCli(["status"])).stdout;
      if (/mbp to duo ok, probed/.test(out) && /duo to mbp ok, probed/.test(out)) break;
      await sleep(200);
    }
    assert.match(out, /tailscale: mbp to duo ok, probed \d+s ago/);
    assert.match(out, /tailscale: duo to mbp ok, probed \d+s ago/);
    const log = (await import("node:fs")).readFileSync(path.join(h.home, "state", "daemon.log"), "utf8");
    assert.match(log, /tailscale probe mbp to duo: ok/);
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("tg status says the watch is off when there is no tailscale.json", async () => {
  const h = await setupHarness();
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    assert.match((await h.runCli(["status"])).stdout, /tailscale: off/);
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("a healthy tick probes each direction exactly once (an exit 0 is not announced a second time)", async () => {
  const r = rig();
  r.script.push(ok, ok);
  await r.watcher.tick();
  await sleep(20); // let any close handlers run
  assert.equal(r.logs.filter((l) => l.startsWith("tailscale probe")).length, 2);
  assert.equal(r.children.length, 2);
});
