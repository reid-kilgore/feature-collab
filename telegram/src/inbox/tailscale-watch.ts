// A standing watch for Tailscale SSH re-approval (DESIGN.md, "Tailscale re-approval watch").
//
// Tailscale SSH asks for a fresh browser approval from time to time. The first sign is an ssh that
// prints a login link and waits. This watch probes each laptop pair on a timer, sends the link to Reid
// once, says when the ssh goes through, and never blocks the daemon: probes are async, and a probe left
// waiting for approval is killed by the check code's own timer.
//
// Two directions. From here: `ssh host true`. From the other laptop back to here: the same probe run
// there, `ssh via "ssh target true"`. That second one works only while here-to-via works, so it is tried
// only when the first goes through, and straight after the first clears.

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { configDir } from "../config.ts";
import { parseDuration } from "../dispatcher/config.ts";
import { isValidAlias, pendingTailscaleChecks, startTailscaleCheck } from "./tailscale.ts";
import type { PendingTailscaleCheck, StartCheckOptions, TailscaleCheckHandle } from "./tailscale.ts";

export interface WatchConfig {
  hosts: string[];
  reverse: Array<{ via: string; target: string }>;
  intervalSeconds: number;
  reminderSeconds: number;
  // How this machine is named in messages ("mbp to duo"); the host name when absent.
  local?: string;
}

export function tailscaleWatchConfigFile(): string {
  return path.join(configDir(), "tailscale.json");
}

export function parseTailscaleWatchConfig(raw: unknown): WatchConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("the file must hold a JSON object");
  const r = raw as Record<string, unknown>;
  if (r.version !== 1) throw new Error('"version" must be 1');
  const hosts = r.hosts ?? [];
  if (!Array.isArray(hosts)) throw new Error('"hosts" must be a list of ssh aliases');
  for (const h of hosts) if (typeof h !== "string" || !isValidAlias(h)) throw new Error(`host "${String(h)}" is not a valid ssh alias`);
  const reverseRaw = r.reverse ?? [];
  if (!Array.isArray(reverseRaw)) throw new Error('"reverse" must be a list of {via, target}');
  const reverse = reverseRaw.map((e, i) => {
    const o = (e ?? {}) as Record<string, unknown>;
    if (typeof o.via !== "string" || typeof o.target !== "string" || !isValidAlias(o.via) || !isValidAlias(o.target)) {
      throw new Error(`reverse[${i}]: "via" and "target" must be valid ssh aliases`);
    }
    return { via: o.via, target: o.target };
  });
  const intervalSeconds = parseDuration(r.interval, 120, "interval");
  const reminderSeconds = parseDuration(r.reminder, 3600, "reminder");
  if (intervalSeconds < 1) throw new Error("interval: must be at least 1s");
  if (reminderSeconds < 1) throw new Error("reminder: must be at least 1s");
  if (r.local !== undefined && (typeof r.local !== "string" || !isValidAlias(r.local))) throw new Error('"local" must be a short name');
  return { hosts: hosts as string[], reverse, intervalSeconds, reminderSeconds, ...(r.local ? { local: r.local as string } : {}) };
}

let cache: { file: string; mtimeMs: number; size: number; value: WatchConfig | undefined; error?: string } | undefined;

// The watch config, or undefined when there is no file or it is invalid (then the watch is off; the
// reason goes to the log once per change).
export function readTailscaleWatchConfig(log: (line: string) => void, file: string = tailscaleWatchConfigFile()): WatchConfig | undefined {
  let stat;
  try {
    stat = statSync(file);
  } catch {
    cache = undefined;
    return undefined;
  }
  if (cache && cache.file === file && cache.mtimeMs === stat.mtimeMs && cache.size === stat.size) return cache.value;
  let value: WatchConfig | undefined;
  let error: string | undefined;
  try {
    value = parseTailscaleWatchConfig(JSON.parse(readFileSync(file, "utf8")));
  } catch (e) {
    error = (e as Error).message;
    log(`tailscale watch is off: tailscale.json is invalid: ${error}`);
  }
  cache = { file, mtimeMs: stat.mtimeMs, size: stat.size, value, error };
  return value;
}

interface WatchState {
  state: "ok" | "needs_check" | "unreachable" | "hung";
  noticeAt?: number;
  // The last probe of this direction: when (ISO) and what it found. Kept so `tg status` and the log can
  // say what the watch last saw, and so a silent watch can be told from a watch that never ran.
  lastProbeAt?: string;
  lastResult?: string;
  // Consecutive probes that neither printed a link nor exited, and whether the user was told.
  hungCount?: number;
  hungNotified?: boolean;
}

export interface WatchRow {
  pair: string;
  state: string;
  lastResult: string;
  ageSeconds: number | null;
}

// What `tg status` shows: one row per direction, from the stored state.
export function describeWatchState(
  getMeta: (key: string) => string | undefined,
  hosts: string[],
  reverse: Array<{ via: string; target: string }>,
  local: string,
  nowMs: number,
): WatchRow[] {
  const rows: WatchRow[] = [];
  const add = (key: string, pair: string) => {
    let st: WatchState | undefined;
    try {
      const raw = getMeta(`tsw:${key}`);
      if (raw) st = JSON.parse(raw) as WatchState;
    } catch {
      // unreadable: shown as not probed
    }
    const at = st?.lastProbeAt ? Date.parse(st.lastProbeAt) : NaN;
    rows.push({
      pair,
      state: st?.state ?? "ok",
      lastResult: st?.lastProbeAt ? (st.lastResult ?? "unknown") : "not probed yet",
      ageSeconds: Number.isFinite(at) ? Math.max(0, Math.round((nowMs - at) / 1000)) : null,
    });
  };
  for (const h of hosts) add(h, `${local} to ${h}`);
  for (const r of reverse) add(`${r.via}>${r.target}`, `${r.via} to ${r.target}`);
  return rows;
}

export interface WatcherDeps {
  startCheck?: (alias: string, options?: StartCheckOptions) => TailscaleCheckHandle;
  send: (html: string, url?: string) => Promise<void>;
  now: () => number;
  // How this machine is named in messages ("mbp to duo").
  localName: string;
  getMeta: (key: string) => string | undefined;
  setMeta: (key: string, value: string) => void;
  log: (line: string) => void;
  config: () => WatchConfig | undefined;
  pending?: Map<string, PendingTailscaleCheck>;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export class TailscaleWatcher {
  private deps: WatcherDeps;
  private pending: Map<string, PendingTailscaleCheck>;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  constructor(deps: WatcherDeps) {
    this.deps = deps;
    this.pending = deps.pending ?? new Map();
  }

  // Runs one tick now and then on the configured interval. The first tick is soon after start, so a
  // restart does not leave a lapse unnoticed for a whole interval.
  start(firstDelayMs = 30_000): void {
    this.stopped = false;
    const run = (delay: number) => {
      this.timer = setTimeout(async () => {
        try {
          await this.tick();
        } catch (error) {
          this.deps.log(`tailscale watch tick failed: ${(error as Error).message}`);
        }
        if (this.stopped) return;
        const config = this.deps.config();
        run((config?.intervalSeconds ?? 60) * 1000);
      }, delay);
      this.timer.unref?.();
    };
    const config = this.deps.config();
    run(Math.min(firstDelayMs, (config?.intervalSeconds ?? 30) * 1000));
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  async tick(): Promise<void> {
    const config = this.deps.config();
    if (!config) return;
    const down = new Set<string>(); // hosts that did not go through this tick
    for (const host of config.hosts) {
      try {
        const outcome = await this.probe(host, undefined, config);
        if (outcome !== "ok") down.add(host);
      } catch (error) {
        this.deps.log(`tailscale watch: probe of ${host} failed: ${(error as Error).message}`);
        down.add(host);
      }
    }
    for (const r of config.reverse) {
      if (down.has(r.via)) continue; // cannot ask a host we cannot reach
      try {
        await this.probe(r.target, r.via, config);
      } catch (error) {
        this.deps.log(`tailscale watch: probe of ${r.via} to ${r.target} failed: ${(error as Error).message}`);
      }
    }
  }

  private key(alias: string, via?: string): string {
    return via ? `${via}>${alias}` : alias;
  }

  private plainLabel(alias: string, via?: string): string {
    return `${via ?? this.deps.config()?.local ?? this.deps.localName} to ${alias}`;
  }

  private label(alias: string, via?: string): string {
    return escapeHtml(this.plainLabel(alias, via));
  }

  private load(key: string): WatchState {
    try {
      const raw = this.deps.getMeta(`tsw:${key}`);
      if (raw) return JSON.parse(raw) as WatchState;
    } catch {
      // fall through
    }
    return { state: "ok" };
  }

  // Merges a change into a direction's stored state, and logs a state change on its own line.
  private patch(alias: string, via: string | undefined, change: Partial<WatchState>): void {
    const key = this.key(alias, via);
    const before = this.load(key);
    const after: WatchState = { ...before, ...change };
    this.deps.setMeta(`tsw:${key}`, JSON.stringify(after));
    if (after.state !== before.state) this.deps.log(`tailscale state ${this.plainLabel(alias, via)}: ${before.state} -> ${after.state}`);
  }

  // Records what a probe found: the time and result are kept, and every probe is logged, healthy or not.
  private record(alias: string, via: string | undefined, result: string, change: Partial<WatchState> = {}): void {
    this.deps.log(`tailscale probe ${this.plainLabel(alias, via)}: ${result}`);
    this.patch(alias, via, { ...change, lastProbeAt: new Date(this.deps.now()).toISOString(), lastResult: result });
  }

  private async probe(alias: string, via: string | undefined, config: WatchConfig): Promise<"ok" | "link" | "pending" | "bad"> {
    const key = this.key(alias, via);
    if (this.pending.has(key)) return "pending";
    const start = this.deps.startCheck ?? startTailscaleCheck;
    const handle = start(alias, { via, hardKillMs: config.reminderSeconds * 1000 });
    const entry: PendingTailscaleCheck = {};
    this.pending.set(key, entry);
    if (handle.child) {
      handle.child.once("close", (code: number | null) => {
        this.pending.delete(key);
        // Only a probe that waited for an approval (it found a link) reports "approved" when it exits 0. A
        // probe that simply worked is handled where its result is read; running it again here would
        // announce twice and probe the reverse direction a second time.
        if (code === 0 && entry.link) void this.cleared(alias, via, config).catch((e) => this.deps.log(`tailscale watch: ${(e as Error).message}`));
      });
    }
    const result = await handle.result;
    if (!handle.child) this.pending.delete(key);

    if (result.kind === "link") {
      entry.link = result.url;
      const st = this.load(key);
      const reminderDue = st.noticeAt !== undefined && this.deps.now() - st.noticeAt >= config.reminderSeconds * 1000;
      if (st.state !== "needs_check" || reminderDue) {
        const lead = st.state === "needs_check" ? "Still waiting: Tailscale SSH needs approval" : "Tailscale SSH needs approval";
        const tail = st.state === "needs_check" ? "Here is a fresh link." : "Tap to approve. I will say when it works.";
        await this.deps.send(`<b>${lead}</b>\n${this.label(alias, via)}\n${tail}`, result.url);
        this.deps.log(`tailscale link sent for ${this.plainLabel(alias, via)}`);
        this.record(alias, via, "needs approval (link sent)", { state: "needs_check", noticeAt: this.deps.now(), hungCount: 0 });
      } else {
        // The last notice is recent and this link was never shown to anyone: do not leave its ssh waiting.
        handle.child?.kill("SIGKILL");
        this.record(alias, via, "needs approval (link already sent)");
      }
      return "link";
    }
    if (result.exitCode === 0) {
      await this.markOk(alias, via);
      this.record(alias, via, "ok");
      return "ok";
    }
    if (result.exitCode === undefined) {
      // No link and no exit within the watch window. Left alone, this ssh would hold the pair for the whole
      // kill timer and no later tick would look at it. Kill it, count it, and say so after two in a row.
      handle.child?.kill("SIGKILL");
      const st = this.load(key);
      const hungCount = (st.hungCount ?? 0) + 1;
      this.record(alias, via, `hung (no link, no exit; ${hungCount} in a row)`, { state: st.state === "needs_check" ? "needs_check" : "hung", hungCount });
      if (hungCount >= 2 && !st.hungNotified) {
        await this.deps.send(`<b>Tailscale probe does not answer</b>\n${this.label(alias, via)}\nssh printed nothing and did not finish, twice in a row. It may be waiting for an approval I cannot see. Try it by hand.`);
        this.patch(alias, via, { hungNotified: true });
      }
      return "bad";
    }
    const st = this.load(key);
    this.record(alias, via, `unreachable (exit ${result.exitCode}: ${result.detail.slice(0, 80)})`, { state: st.state === "needs_check" ? "needs_check" : "unreachable", hungCount: 0 });
    return "bad";
  }

  // The waiting ssh exited 0: the approval went through. Say so, then try the direction that was blocked
  // behind this one.
  private async cleared(alias: string, via: string | undefined, config: WatchConfig): Promise<void> {
    await this.markOk(alias, via);
    if (via) return;
    for (const r of config.reverse) {
      if (r.via === alias) await this.probe(r.target, r.via, config);
    }
  }

  private async markOk(alias: string, via: string | undefined): Promise<void> {
    const key = this.key(alias, via);
    const st = this.load(key);
    if (st.state === "needs_check") await this.deps.send(`<b>Tailscale SSH works again</b>\n${this.label(alias, via)}`);
    else if (st.hungNotified) await this.deps.send(`<b>Tailscale probe answers again</b>\n${this.label(alias, via)}`);
    this.patch(alias, via, { state: "ok", hungCount: 0, hungNotified: false, noticeAt: undefined });
  }
}
