// dispatcher.json: the optional config for the dispatcher session (DESIGN-dispatcher.md).
//
// Missing file: the feature is off and routing is exactly what it was before. Malformed file:
// the feature is off, the reason is kept for `tg doctor` and `/status`, and nothing throws. The
// daemon re-reads the file on every inbound message (cached by mtime), so flipping "enabled"
// needs no restart.

import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { configDir } from "../config.ts";

export function dispatcherConfigFile(): string {
  return path.join(configDir(), "dispatcher.json");
}

export interface TargetNudge {
  // The name of the session to message directly, and the text template for the message.
  to: string;
  template: string;
}

export interface Target {
  name: string;
  description: string;
  // Exactly one of argv / builtin.
  argv?: string[];
  builtin?: "claude-session";
  allowedCwds?: string[];
  ack: string;
  nudge?: TargetNudge;
}

export interface DispatcherConfig {
  enabled: boolean;
  channel: string;
  model: string;
  waitTimeoutSeconds: number;
  liveReplyTtlSeconds: number;
  downNoticeAfterSeconds: number;
  // claudeBin: the claude executable. A tmux window does not read the user's shell profile, so a
  // `claude` installed in a directory only the profile adds to PATH (~/.local/bin) is not found there;
  // give the full path in that case.
  session: { tmuxSession: string; tmuxSessionSet: boolean; window: string; cwd: string; allowedTools: string[]; claudeBin: string; name?: string };
  inboxCommands: boolean;
  defaultTarget: string | undefined;
  targets: Target[];
}

export type DispatcherConfigState =
  | { state: "absent" }
  | { state: "invalid"; error: string }
  | { state: "ok"; config: DispatcherConfig };

export function parseDuration(text: unknown, fallbackSeconds: number, field: string): number {
  if (text === undefined) return fallbackSeconds;
  const match = typeof text === "string" ? /^(\d+)(s|m|h|d)?$/.exec(text.trim()) : null;
  if (!match) throw new Error(`${field}: "${String(text)}" is not a duration like 90s, 15m or 1h`);
  return Number(match[1]) * { s: 1, m: 60, h: 3600, d: 86400 }[(match[2] ?? "s") as "s" | "m" | "h" | "d"];
}

export function expandHome(p: string): string {
  return p === "~" ? homedir() : p.startsWith("~/") ? path.join(homedir(), p.slice(2)) : p;
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const SAFE_WORD = /^[A-Za-z0-9_.:@%/+~-]+$/;

export function parseDispatcherConfig(raw: unknown): DispatcherConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("the file must hold a JSON object");
  const r = raw as Record<string, unknown>;
  if (r.version !== 1) throw new Error('"version" must be 1');

  const str = (value: unknown, field: string, fallback: string, pattern = SAFE_WORD): string => {
    const v = value === undefined ? fallback : value;
    if (typeof v !== "string" || !pattern.test(v)) throw new Error(`${field}: invalid value`);
    return v;
  };

  const sessionRaw = (r.session ?? {}) as Record<string, unknown>;
  const toolsRaw = sessionRaw.allowedTools ?? ["Bash(tg:*)"];
  if (!Array.isArray(toolsRaw) || !toolsRaw.every((t) => typeof t === "string" && /^[A-Za-z0-9_():*, .-]+$/.test(t))) {
    throw new Error("session.allowedTools: must be a list of tool patterns");
  }

  const targetsRaw = r.targets ?? [];
  if (!Array.isArray(targetsRaw)) throw new Error('"targets" must be a list');
  const targets: Target[] = targetsRaw.map((t, i) => {
    const o = (t ?? {}) as Record<string, unknown>;
    const where = `targets[${i}]`;
    const name = str(o.name, `${where}.name`, "", NAME);
    if (typeof o.description !== "string" || !o.description.trim()) throw new Error(`${where}.description: required`);
    const hasArgv = Array.isArray(o.argv);
    const hasBuiltin = o.builtin !== undefined;
    if (hasArgv === hasBuiltin) throw new Error(`${where}: give exactly one of "argv" or "builtin"`);
    if (hasArgv && !(o.argv as unknown[]).every((a) => typeof a === "string") ) throw new Error(`${where}.argv: must be a list of strings`);
    if (hasArgv && (o.argv as unknown[]).length === 0) throw new Error(`${where}.argv: must not be empty`);
    if (hasBuiltin && o.builtin !== "claude-session") throw new Error(`${where}.builtin: unknown builtin`);
    if (o.builtin === "claude-session") {
      if (!Array.isArray(o.allowedCwds) || o.allowedCwds.length === 0 || !o.allowedCwds.every((c) => typeof c === "string")) {
        throw new Error(`${where}.allowedCwds: a non-empty list of directories is required`);
      }
    }
    let nudge: TargetNudge | undefined;
    if (o.nudge !== undefined) {
      const n = o.nudge as Record<string, unknown>;
      if (typeof n.to !== "string" || !n.to || typeof n.template !== "string" || !n.template) throw new Error(`${where}.nudge: needs "to" and "template"`);
      nudge = { to: n.to, template: n.template };
    }
    return {
      name,
      description: o.description,
      ...(hasArgv ? { argv: o.argv as string[] } : {}),
      ...(hasBuiltin ? { builtin: o.builtin as "claude-session" } : {}),
      ...(Array.isArray(o.allowedCwds) ? { allowedCwds: o.allowedCwds as string[] } : {}),
      ack: typeof o.ack === "string" && o.ack ? o.ack : "Sent to {{name}}.",
      ...(nudge ? { nudge } : {}),
    };
  });
  const names = new Set<string>();
  for (const t of targets) {
    if (names.has(t.name)) throw new Error(`targets: duplicate name "${t.name}"`);
    names.add(t.name);
  }
  const defaultTarget = r.defaultTarget === undefined ? undefined : String(r.defaultTarget);
  if (defaultTarget !== undefined && !names.has(defaultTarget)) throw new Error(`defaultTarget "${defaultTarget}" is not one of the targets`);

  return {
    enabled: r.enabled === undefined ? true : r.enabled === true,
    channel: str(r.channel, "channel", "dispatcher", NAME),
    model: str(r.model, "model", "sonnet"),
    waitTimeoutSeconds: parseDuration(r.waitTimeout, 3600, "waitTimeout"),
    liveReplyTtlSeconds: parseDuration(r.liveReplyTtl, 900, "liveReplyTtl"),
    downNoticeAfterSeconds: parseDuration(r.downNoticeAfter, 120, "downNoticeAfter"),
    session: {
      tmuxSession: str(sessionRaw.tmuxSession, "session.tmuxSession", "main"),
      // Whether the file names a tmux session. When it does not, a new Claude session opens in the session
      // the dispatcher itself runs in (the default "main" is used only by `tg dispatcher start`, and for a
      // new window when not inside tmux at all).
      tmuxSessionSet: sessionRaw.tmuxSession !== undefined,
      window: str(sessionRaw.window, "session.window", "tg-dispatcher"),
      cwd: str(sessionRaw.cwd, "session.cwd", "~"),
      allowedTools: toolsRaw as string[],
      claudeBin: str(sessionRaw.claudeBin, "session.claudeBin", "claude"),
      // A fixed display name for the session, so other sessions can address it; without one the name is
      // derived from the directory and can change between starts.
      ...(sessionRaw.name !== undefined ? { name: str(sessionRaw.name, "session.name", "", NAME) } : {}),
    },
    inboxCommands: r.inboxCommands === true,
    defaultTarget,
    targets,
  };
}

let cache: { file: string; mtimeMs: number; size: number; value: DispatcherConfigState } | undefined;

export function readDispatcherConfig(file: string = dispatcherConfigFile()): DispatcherConfigState {
  let stat;
  try {
    stat = statSync(file);
  } catch {
    cache = undefined;
    return { state: "absent" };
  }
  if (cache && cache.file === file && cache.mtimeMs === stat.mtimeMs && cache.size === stat.size) return cache.value;
  let value: DispatcherConfigState;
  try {
    value = { state: "ok", config: parseDispatcherConfig(JSON.parse(readFileSync(file, "utf8"))) };
  } catch (error) {
    value = { state: "invalid", error: (error as Error).message };
  }
  cache = { file, mtimeMs: stat.mtimeMs, size: stat.size, value };
  return value;
}

// The config when the dispatcher is on: file valid and "enabled" true. Anything else is the old routing.
export function activeDispatcher(file?: string): DispatcherConfig | undefined {
  const state = readDispatcherConfig(file);
  return state.state === "ok" && state.config.enabled ? state.config : undefined;
}

// The config when the file is valid, whether or not "enabled" is true. "enabled" decides only whether the
// daemon routes real Telegram messages to the dispatcher; the session commands, and the single-listener
// rule, work either way so a new install can be started and tried before it goes live.
export function validDispatcher(file?: string): DispatcherConfig | undefined {
  const state = readDispatcherConfig(file);
  return state.state === "ok" ? state.config : undefined;
}
