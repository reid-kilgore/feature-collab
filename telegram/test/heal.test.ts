// The dispatcher self-heal (src/daemon/heal.ts), driven with fakes: a fake clock, a fake listener state and a
// fake process table. Nothing here starts a daemon, a tmux server or a real process.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DispatcherHealer, parseLimit, parseSchedule, type HealDeps } from "../src/daemon/heal.ts";

const MIN = 60_000;

interface Fake {
  deps: HealDeps;
  clock: { t: number };
  state: { active: boolean; listening: boolean; downSince: number; pid: number | undefined; screen: string; alive: boolean };
  kills: Array<{ pid: unknown; signal: string }>;
  notices: string[];
  audits: Array<{ kind: string; detail: any }>;
  logs: string[];
}

function fake(scheduleMs = [5 * MIN, 15 * MIN, 60 * MIN]): Fake {
  const clock = { t: Date.parse("2026-10-28T05:00:00Z") };
  const state = { active: true, listening: false, downSince: clock.t, pid: 48258 as number | undefined, screen: "", alive: false };
  const f: Fake = { clock, state, kills: [], notices: [], audits: [], logs: [], deps: undefined as unknown as HealDeps };
  f.deps = {
    now: () => clock.t,
    active: () => state.active,
    listening: () => state.listening,
    noListenerSeconds: () => Math.floor((clock.t - state.downSince) / 1000),
    findPid: () => state.pid,
    screen: () => state.screen,
    kill: (pid, signal) => void f.kills.push({ pid, signal }),
    isAlive: () => state.alive,
    sleep: async (ms) => void (clock.t += ms),
    notify: async (text) => void f.notices.push(text),
    audit: (kind, detail) => void f.audits.push({ kind, detail }),
    log: (line) => void f.logs.push(line),
    scheduleMs,
  };
  return f;
}

const advance = (f: Fake, ms: number) => void (f.clock.t += ms);

test("a listener down for five minutes restarts the session; before that nothing happens", async () => {
  const f = fake();
  const healer = new DispatcherHealer(f.deps);
  advance(f, 4 * MIN);
  await healer.tick();
  assert.equal(f.kills.length, 0);
  advance(f, 1 * MIN + 1000);
  await healer.tick();
  assert.deepEqual(f.kills, [{ pid: 48258, signal: "SIGTERM" }]);
  assert.equal(f.audits.filter((a) => a.kind === "dispatcher_self_restart").length, 1);
  assert.equal(f.audits[0]!.detail.attempt, 1);
});

test("a listener that is up, or a dispatcher that is off, is left alone", async () => {
  const f = fake();
  const healer = new DispatcherHealer(f.deps);
  advance(f, 30 * MIN);
  f.state.listening = true;
  await healer.tick();
  f.state.listening = false;
  f.state.active = false;
  await healer.tick();
  assert.equal(f.kills.length, 0);
});

test("a restart that does not bring the listener back backs off 15 then 60 minutes, and stays at 60", async () => {
  const f = fake();
  const healer = new DispatcherHealer(f.deps);
  advance(f, 5 * MIN);
  await healer.tick(); // attempt 1
  const restartsAfter = async (ms: number) => {
    advance(f, ms);
    await healer.tick();
    return f.kills.filter((k) => k.signal === "SIGTERM").length;
  };
  assert.equal(await restartsAfter(14 * MIN), 1);
  assert.equal(await restartsAfter(2 * MIN), 2); // 16 minutes after attempt 1 (the 10 s kill grace counts too)
  assert.equal(await restartsAfter(59 * MIN), 2);
  assert.equal(await restartsAfter(2 * MIN), 3);
  assert.equal(await restartsAfter(59 * MIN), 3);
  assert.equal(await restartsAfter(2 * MIN), 4); // still 60 minutes apart
});

test("a usage limit with a reset time holds the restart until just after that time", async () => {
  const f = fake();
  const healer = new DispatcherHealer(f.deps);
  // Local-time reset about 90 minutes from now, written the way claude prints it.
  const reset = new Date(f.clock.t + 90 * MIN);
  const hh = reset.getHours() % 12 === 0 ? 12 : reset.getHours() % 12;
  const mm = String(reset.getMinutes()).padStart(2, "0");
  f.state.screen = `You've hit your session limit · resets ${hh}:${mm}${reset.getHours() >= 12 ? "pm" : "am"}\n> `;
  advance(f, 10 * MIN);
  await healer.tick();
  advance(f, 60 * MIN); // 70 minutes down, 20 before the reset
  await healer.tick();
  assert.equal(f.kills.length, 0);
  advance(f, 20 * MIN); // at the reset time itself, 90 minutes down
  await healer.tick();
  assert.equal(f.kills.length, 0, "the margin after the reset has not passed yet");
  advance(f, 2 * MIN);
  await healer.tick();
  assert.equal(f.kills.length, 1);
  assert.match(f.notices[0]!, /usage limit/);
});

test("a usage limit with no readable reset time still follows the schedule", async () => {
  const f = fake();
  const healer = new DispatcherHealer(f.deps);
  f.state.screen = "You've hit your weekly limit · resets Nov 3 at 9am";
  advance(f, 6 * MIN);
  await healer.tick();
  assert.equal(f.kills.length, 1);
});

test("one notice per incident, however many restarts; a new incident gets its own", async () => {
  const f = fake();
  const healer = new DispatcherHealer(f.deps);
  advance(f, 5 * MIN);
  await healer.tick();
  advance(f, 16 * MIN);
  await healer.tick();
  advance(f, 61 * MIN);
  await healer.tick();
  assert.equal(f.kills.filter((k) => k.signal === "SIGTERM").length, 3);
  assert.equal(f.notices.length, 1);
  // The listener returns: the incident is over. It goes down again later.
  f.state.listening = true;
  await healer.tick();
  f.state.listening = false;
  f.state.downSince = f.clock.t;
  advance(f, 6 * MIN);
  await healer.tick();
  assert.equal(f.kills.filter((k) => k.signal === "SIGTERM").length, 4);
  assert.equal(f.notices.length, 2);
  assert.equal(f.audits.at(-1)!.detail.attempt, 1, "the attempt count starts again");
});

test("the kill is by pid only: a number goes to kill, a stubborn process gets SIGKILL on the same pid", async () => {
  const f = fake();
  f.state.alive = true;
  const healer = new DispatcherHealer(f.deps);
  advance(f, 5 * MIN);
  await healer.tick();
  assert.deepEqual(f.kills, [
    { pid: 48258, signal: "SIGTERM" },
    { pid: 48258, signal: "SIGKILL" },
  ]);
  for (const k of f.kills) assert.equal(typeof k.pid, "number");
  // The module never shells out to a by-name killer.
  const source = readFileSync(new URL("../src/daemon/heal.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /pkill|killall|pgrep/);
});

test("no dispatcher process found: nothing is killed, nothing is noticed, and the log says so once", async () => {
  const f = fake();
  f.state.pid = undefined;
  const healer = new DispatcherHealer(f.deps);
  advance(f, 6 * MIN);
  await healer.tick();
  advance(f, 1 * MIN);
  await healer.tick();
  assert.equal(f.kills.length, 0);
  assert.equal(f.notices.length, 0);
  assert.equal(f.logs.filter((l) => /no dispatcher claude process/.test(l)).length, 1);
  // The process appears: the restart then happens without a fresh wait.
  f.state.pid = 51;
  await healer.tick();
  assert.deepEqual(f.kills[0], { pid: 51, signal: "SIGTERM" });
});

test("an empty schedule turns the watchdog off", async () => {
  const f = fake([]);
  const healer = new DispatcherHealer(f.deps);
  advance(f, 600 * MIN);
  await healer.tick();
  assert.equal(f.kills.length, 0);
});

test("parseSchedule and parseLimit", () => {
  assert.deepEqual(parseSchedule(undefined), [5 * MIN, 15 * MIN, 60 * MIN]);
  assert.deepEqual(parseSchedule("2, 10"), [2 * MIN, 10 * MIN]);
  assert.deepEqual(parseSchedule("off"), []);
  assert.deepEqual(parseSchedule("x,5"), [5 * MIN, 15 * MIN, 60 * MIN]);
  const now = new Date(2026, 9, 28, 2, 0, 0).getTime();
  assert.equal(parseLimit("all fine", now).limited, false);
  assert.equal(parseLimit("You've hit your session limit · resets 1:40am", now).resetAt, new Date(2026, 9, 29, 1, 40).getTime());
  assert.equal(parseLimit("You've hit your usage limit · resets 5pm", now).resetAt, new Date(2026, 9, 28, 17, 0).getTime());
  assert.equal(parseLimit("You've hit your session limit · resets 12am", now).resetAt, new Date(2026, 9, 29, 0, 0).getTime());
  assert.deepEqual(parseLimit("You've hit your weekly limit · resets Nov 3 at 9am", now), { limited: true });
});
