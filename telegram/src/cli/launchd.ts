// The launchd job that keeps the daemon up (installed by `tg setup`). The CLI asks launchd to start the daemon
// when this job exists, instead of starting its own: a daemon that launchd does not own holds the lock, so the job
// then exits "already running" every few seconds and `launchctl kickstart` stops helping. Every call that touches
// the system takes its command as an argument, so tests never run a real launchctl.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { isTestMode, lockFile } from "../config.ts";

export const LAUNCHD_LABEL = "com.reid.agent-telegram";

// Runs a command and returns its stdout; throws when it fails.
export type RunCommand = (file: string, args: string[]) => string;

export const realRun: RunCommand = (file, args) =>
  execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000 });

export function launchdPlistPath(home: string = homedir()): string {
  return path.join(home, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
}

// True when the launchd plist that `tg setup` writes exists (macOS only).
export function launchdInstalled(plistExists: (p: string) => boolean = existsSync, home?: string): boolean {
  // Real checks only: never under AGENT_TELEGRAM_HOME (the job belongs to the real state dir), never off macOS.
  if (plistExists === existsSync && (isTestMode() || process.platform !== "darwin")) return false;
  return plistExists(launchdPlistPath(home));
}

function serviceTarget(uid: number): string {
  return `gui/${uid}/${LAUNCHD_LABEL}`;
}

// Asks launchd to start the job (no -k: a job that is already running is left alone). True when launchctl accepted it.
export function kickstartLaunchd(run: RunCommand = realRun, uid: number = process.getuid?.() ?? 0): boolean {
  try {
    run("launchctl", ["kickstart", serviceTarget(uid)]);
    return true;
  } catch {
    return false;
  }
}

// The pid launchd says it runs for the job, or undefined (not loaded, or loaded with no process).
export function launchdJobPid(run: RunCommand = realRun, uid: number = process.getuid?.() ?? 0): number | undefined {
  try {
    const match = /^\s*pid = (\d+)\s*$/m.exec(run("launchctl", ["print", serviceTarget(uid)]));
    return match ? Number(match[1]) : undefined;
  } catch {
    return undefined;
  }
}

export function lockHolderPid(read: (p: string) => string = (p) => readFileSync(p, "utf8")): number | undefined {
  try {
    const pid = Number(read(lockFile()).trim());
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

export interface StrayDeps {
  installed: () => boolean;
  lockPid: () => number | undefined;
  alive: (pid: number) => boolean;
  jobPid: () => number | undefined;
  uid?: number;
}

// A `tg doctor` line when a daemon runs that launchd did not start while a launchd job is installed; else undefined.
export function strayDaemonWarning(deps: StrayDeps): string | undefined {
  if (!deps.installed()) return undefined;
  const lock = deps.lockPid();
  if (lock === undefined || !deps.alive(lock)) return undefined;
  const job = deps.jobPid();
  if (job === lock) return undefined;
  return (
    `WARNING: the running daemon (pid ${lock}) was not started by launchd (${LAUNCHD_LABEL} ` +
    `${job === undefined ? "has no process" : `runs pid ${job}`}). The launchd job cannot start while it holds the lock. ` +
    `Stop that process, then run: launchctl kickstart gui/${deps.uid ?? "<uid>"}/${LAUNCHD_LABEL}`
  );
}

export function strayDaemonWarningReal(): string | undefined {
  return strayDaemonWarning({
    installed: () => launchdInstalled(),
    lockPid: () => lockHolderPid(),
    alive: (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (e) {
        return (e as NodeJS.ErrnoException).code === "EPERM";
      }
    },
    jobPid: () => launchdJobPid(),
    uid: process.getuid?.(),
  });
}
