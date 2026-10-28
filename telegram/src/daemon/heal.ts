// The dispatcher self-heal (DESIGN-dispatcher.md, "Listener self-heal"). `tg dispatcher start` runs claude in a
// restart loop, but the loop restarts only when claude EXITS. A session that hit the Claude usage limit, or sat at
// a login prompt, stays running with no listener. This watchdog notices that from the daemon's own listener
// count and kills the dispatcher's claude process, by pid, so the loop starts a fresh session. It does not touch
// how messages are routed or consumed.
//
// Pacing: the first restart comes after the listener has been down for the first schedule step (default 5
// minutes). If the listener is still not back, the next restart waits the next step (15, then 60 minutes, and
// 60 from then on), counted from the previous restart. If the dispatcher's screen shows the usage limit with a
// reset time, no restart happens before that time. One Telegram notice per incident (an incident ends when a
// listener attaches), sent at the first restart.

import { execFileSync } from "node:child_process";
import { tmuxBin } from "../config.ts";

export const DEFAULT_SCHEDULE_MIN = [5, 15, 60];
const RESET_MARGIN_MS = 60_000;
const MAX_RESET_WAIT_MS = 24 * 3_600_000;
const KILL_GRACE_MS = 10_000;
// Every dispatcher claude command line carries this flag (buildDispatcherCommand), so it marks the right process.
const DISPATCHER_MARKER = "--append-system-prompt-file";

// "5,15,60" (minutes) -> milliseconds. "off" disables the watchdog. A bad value falls back to the default.
export function parseSchedule(text: string | undefined): number[] {
  const fallback = DEFAULT_SCHEDULE_MIN.map((m) => m * 60_000);
  if (text === undefined || text.trim() === "") return fallback;
  if (/^(off|0|false|no)$/i.test(text.trim())) return [];
  const parts = text.split(",").map((p) => Number(p.trim()));
  if (parts.some((n) => !Number.isFinite(n) || n <= 0)) return fallback;
  return parts.map((m) => Math.round(m * 60_000));
}

// Claude prints "You've hit your session limit · resets 1:40am" (also "usage limit", "weekly limit", "resets 5pm").
// The time is read as local to the machine. Only the next occurrence within 24 hours is believed. A date form is
// not parsed, so the pacing schedule applies alone. resetAt is undefined when no usable time is shown.
export function parseLimit(screen: string, nowMs: number): { limited: boolean; resetAt?: number } {
  if (!/(session|usage|weekly|rate)\s+limit/i.test(screen)) return { limited: false };
  const re = /limit[^\n]*?resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*([ap]m)\b/gi;
  let last: RegExpExecArray | null = null;
  for (let m = re.exec(screen); m; m = re.exec(screen)) last = m;
  if (!last) return { limited: true };
  let hour = Number(last[1]) % 12;
  if (last[3]!.toLowerCase() === "pm") hour += 12;
  const at = new Date(nowMs);
  at.setHours(hour, Number(last[2] ?? 0), 0, 0);
  if (at.getTime() <= nowMs) at.setDate(at.getDate() + 1);
  if (at.getTime() - nowMs > MAX_RESET_WAIT_MS) return { limited: true };
  return { limited: true, resetAt: at.getTime() };
}

export interface HealDeps {
  now: () => number;
  // The dispatcher is configured and on; false clears any incident.
  active: () => boolean;
  listening: () => boolean;
  // Seconds without a listener (the daemon's own figure).
  noListenerSeconds: () => number;
  // The pid of the dispatcher's claude process, or undefined when there is none to find.
  findPid: () => number | undefined;
  // What the dispatcher's window shows now.
  screen: () => string;
  kill: (pid: number, signal: "SIGTERM" | "SIGKILL") => void;
  isAlive: (pid: number) => boolean;
  sleep: (ms: number) => Promise<void>;
  notify: (text: string) => Promise<void>;
  audit: (kind: string, detail: unknown) => void;
  log: (line: string) => void;
  scheduleMs: number[];
}

interface Incident {
  attempts: number;
  startedAt: number;
  // The time the next wait is counted from: when the listener went away, then the last restart.
  anchor: number;
  notified: boolean;
  // The first reset time read off the screen. The message stays on screen after the reset, and read again it
  // would point at tomorrow, so it is read once per session and dropped at each restart.
  resetAt?: number;
  noProcessLogged: boolean;
}

export class DispatcherHealer {
  private incident: Incident | undefined;
  private running = false;
  private readonly d: HealDeps;
  constructor(deps: HealDeps) {
    this.d = deps;
  }

  async tick(): Promise<void> {
    const d = this.d;
    if (this.running || d.scheduleMs.length === 0) return;
    this.running = true;
    try {
      if (!d.active()) {
        this.incident = undefined;
        return;
      }
      if (d.listening()) {
        if (this.incident) d.log(`dispatcher listener is back after ${this.incident.attempts} self-restart(s)`);
        this.incident = undefined;
        return;
      }
      const now = d.now();
      if (!this.incident) {
        const since = now - d.noListenerSeconds() * 1000;
        this.incident = { attempts: 0, startedAt: since, anchor: since, notified: false, noProcessLogged: false };
      }
      const inc = this.incident;
      let due = inc.anchor + d.scheduleMs[Math.min(inc.attempts, d.scheduleMs.length - 1)]!;
      if (now < due) return;
      const limit = parseLimit(d.screen(), now);
      if (inc.resetAt === undefined && limit.resetAt !== undefined) inc.resetAt = limit.resetAt;
      if (inc.resetAt !== undefined) due = Math.max(due, inc.resetAt + RESET_MARGIN_MS);
      if (now < due) return;
      const pid = d.findPid();
      if (pid === undefined) {
        if (!inc.noProcessLogged) d.log("dispatcher listener is down but no dispatcher claude process was found; nothing to restart");
        inc.noProcessLogged = true;
        return;
      }
      inc.noProcessLogged = false;
      await this.restart(inc, pid, now, limit);
    } finally {
      this.running = false;
    }
  }

  private async restart(inc: Incident, pid: number, now: number, limit: { limited: boolean; resetAt?: number }): Promise<void> {
    const d = this.d;
    inc.attempts += 1;
    inc.anchor = now;
    inc.resetAt = undefined;
    const downSeconds = Math.round((now - inc.startedAt) / 1000);
    d.audit("dispatcher_self_restart", { pid, attempt: inc.attempts, downSeconds, limited: limit.limited, resetAt: limit.resetAt ? new Date(limit.resetAt).toISOString() : null });
    d.log(`dispatcher listener down ${downSeconds}s: restarting the dispatcher session (pid ${pid}, attempt ${inc.attempts})`);
    try {
      d.kill(pid, "SIGTERM");
      await d.sleep(KILL_GRACE_MS);
      if (d.isAlive(pid)) d.kill(pid, "SIGKILL");
    } catch (e) {
      d.log(`dispatcher restart: kill of pid ${pid} failed: ${(e as Error).message}`);
    }
    if (inc.notified) return;
    inc.notified = true;
    const mins = Math.max(1, Math.round(downSeconds / 60));
    const text = `The dispatcher had no listener for ${mins} min, so I restarted its session.${limit.limited ? " Claude shows a usage limit, so it may not come back until the limit resets." : ""} I will retry later if it does not return, and I will not message again for this outage.`;
    await d.notify(text).catch((e: Error) => d.log(`dispatcher restart notice failed: ${e.message}`));
  }
}

// The real process probes. The dispatcher window is found through tmux, and its claude is the pane shell's
// child that carries the dispatcher's flag. Only a pid is ever signalled.
export function processProbes(): Pick<HealDeps, "kill" | "isAlive" | "sleep"> {
  return {
    kill: (pid, signal) => void process.kill(pid, signal),
    isAlive: (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

export function windowProbes(session: string, window: string): Pick<HealDeps, "findPid" | "screen"> {
  const target = `${session}:${window}`;
  const tmux = (args: string[]) => execFileSync(tmuxBin(), args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 });
  return {
    findPid: () => {
      const panePids = tmux(["list-panes", "-t", target, "-F", "#{pane_pid}"]).split("\n").filter(Boolean);
      const table = execFileSync("ps", ["-A", "-o", "pid=,ppid=,command="], { encoding: "utf8", timeout: 10_000 }).split("\n");
      for (const line of table) {
        const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
        if (m && panePids.includes(m[2]!) && m[3]!.includes(DISPATCHER_MARKER)) return Number(m[1]);
      }
      return undefined;
    },
    screen: () => tmux(["capture-pane", "-p", "-t", target]),
  };
}
