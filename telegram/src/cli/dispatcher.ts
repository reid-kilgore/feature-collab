// tg dispatcher / tg dispatch / tg inquiries (DESIGN-dispatcher.md).
//
// The dispatcher session has one tool, `tg`. Everything it can do to a message is here: wait for
// messages, hand one to a target the config names, ask Reid a question, read the inquiry log.

import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { oneShot, RECONNECT_LIMIT_MS, RECONNECT_BASE_MS, RECONNECT_MAX_MS } from "./client.ts";
import { stateDir, redact, tmuxBin } from "../config.ts";
import { readDispatcherConfig, expandHome, validAddress } from "../dispatcher/config.ts";
import type { DispatcherConfig, Target } from "../dispatcher/config.ts";
import { DISPATCHER_PROTOCOL } from "../dispatcher/protocol.ts";
import { findInquiry, isOpen, readInquiries } from "../core/inquiry-log.ts";
import type { Inquiry } from "../core/inquiry-log.ts";
import type { DaemonResponse, ErrorResponse, RecvResponse, StatusResponse, NotifyResponse, InquiryResponse, TrialResponse, SweepResponse } from "../daemon/protocol.ts";

function fail(message: string): void {
  console.error(redact(message));
  process.exitCode = 1;
}

function parseDuration(text: string): number {
  const match = /^(\d+)(s|m|h|d)?$/.exec(text.trim());
  if (!match) throw new Error(`Invalid duration: ${text}`);
  return Number(match[1]) * { s: 1, m: 60, h: 3600, d: 86400 }[(match[2] ?? "s") as "s" | "m" | "h" | "d"];
}

// A valid config (enabled or not), or a printed reason.
function requireConfig(): DispatcherConfig | undefined {
  const state = readDispatcherConfig();
  if (state.state === "absent") {
    fail("no dispatcher.json: the dispatcher is not configured (see examples/dispatcher.example.json)");
    return undefined;
  }
  if (state.state === "invalid") {
    fail(`dispatcher.json is invalid: ${state.error}`);
    return undefined;
  }
  // "enabled": false only stops the daemon routing real messages here; the session commands still run.
  return state.config;
}

function isError(response: DaemonResponse): response is ErrorResponse {
  return "error" in response;
}

// ---- tg dispatcher ----

export async function cmdDispatcher(argv: string[]): Promise<void> {
  const sub = argv[0];
  switch (sub) {
    case "wait":
      return dispatcherWait();
    case "targets":
      return dispatcherTargets();
    case "start":
      return dispatcherStart();
    case "stop":
      return dispatcherStop();
    case "trial":
      return dispatcherTrial(argv.slice(1));
    case "status":
      return dispatcherStatus();
    case "sweep":
      return dispatcherSweep(argv.slice(1));
    default:
      fail("usage: tg dispatcher wait | targets | start | stop | status | sweep | trial \"text\"");
  }
}

const SWEEP_INTERVAL_SECONDS = 30 * 60;

// Stale questions due a ping, as a `sweep` field for the wake-up; nothing (never an error) when none
// are due or the daemon cannot say.
async function sweepField(): Promise<{ sweep?: unknown[] }> {
  try {
    const r = await oneShot({ op: "sweep", action: "due" });
    const due = isError(r) ? [] : (r as SweepResponse).due ?? [];
    return due.length ? { sweep: due } : {};
  } catch {
    return {};
  }
}

// tg dispatcher sweep [ping ID | cancel ID]: no argument lists the questions due a ping; `ping` records
// that the asker was asked (it is left alone for three hours); `cancel` cancels the question and tells
// Reid once.
async function dispatcherSweep(argv: string[]): Promise<void> {
  const action = argv[0];
  if (action === undefined) {
    const r = await oneShot({ op: "sweep", action: "due" }).catch((e: Error) => ({ error: e.message }));
    if (isError(r as DaemonResponse)) return fail((r as ErrorResponse).error);
    console.log(JSON.stringify({ due: (r as SweepResponse).due ?? [] }));
    return;
  }
  const id = argv[1];
  if ((action !== "ping" && action !== "cancel") || !id) return fail("usage: tg dispatcher sweep [ping <id> | cancel <id>]");
  try {
    const r = await oneShot({ op: "sweep", action, id });
    if (isError(r)) return fail(r.error);
    if (action === "cancel") {
      const state = readDispatcherConfig();
      const channel = state.state === "ok" ? state.config.channel : "dispatcher";
      const sent = await oneShot({ op: "notify", level: "warning", body: `Cancelled the open question \`${id}\`: the session that asked it could not be reached.`, channel });
      if (isError(sent)) return fail(sent.error);
    }
    console.log(JSON.stringify({ status: action === "ping" ? "pinged" : "cancelled", id }));
  } catch (error) {
    fail((error as Error).message);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A failure to reach the daemon, or a connection the daemon dropped mid-wait: worth another try.
// A daemon that answers with an error (for example "already has a listener") is not.
function isConnectionLoss(error: unknown): boolean {
  const message = (error as Error).message ?? "";
  return /Could not connect to the agent-telegram daemon|daemon closed the connection/.test(message);
}

async function dispatcherWait(): Promise<void> {
  const config = requireConfig();
  if (!config) return;
  const onSigint = () => {
    process.stdout.write(JSON.stringify({ version: 1, status: "timeout", messages: [], protocol: DISPATCHER_PROTOCOL }) + "\n");
    process.exit(2);
  };
  process.on("SIGINT", onSigint);
  // The wait ends at least every SWEEP_INTERVAL_SECONDS, so the dispatcher wakes for the question sweep.
  const waitUntil = Date.now() + Math.min(config.waitTimeoutSeconds, SWEEP_INTERVAL_SECONDS) * 1000;
  let lostSince: number | undefined;
  let attempt = 0;
  try {
    for (;;) {
      // The whole wait still ends at the configured timeout, however many times the daemon came and went.
      const remainingSeconds = Math.max(1, Math.ceil((waitUntil - Date.now()) / 1000));
      try {
        const response = await oneShot({ op: "recv", wait: true, peek: false, timeoutSeconds: remainingSeconds, channel: config.channel });
        if (isError(response)) {
          fail(response.error);
          return;
        }
        const recv = response as RecvResponse;
        process.stdout.write(JSON.stringify({ ...recv, ...(await sweepField()), protocol: DISPATCHER_PROTOCOL, rearm: "tg dispatcher wait" }) + "\n");
        process.exitCode = recv.status === "received" ? 0 : 2;
        return;
      } catch (error) {
        if (!isConnectionLoss(error)) {
          fail((error as Error).message);
          return;
        }
        const now = Date.now();
        lostSince ??= now;
        if (now >= waitUntil) {
          process.stdout.write(JSON.stringify({ version: 1, status: "timeout", messages: [], ...(await sweepField()), protocol: DISPATCHER_PROTOCOL, rearm: "tg dispatcher wait" }) + "\n");
          process.exitCode = 2;
          return;
        }
        if (now - lostSince >= RECONNECT_LIMIT_MS) {
          fail(`lost the daemon for ${Math.round((now - lostSince) / 1000)}s and could not reconnect: ${(error as Error).message}. Run \`tg dispatcher wait\` again once it is back (\`tg doctor\` says what is wrong).`);
          return;
        }
        await sleep(Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS));
        attempt++;
      }
    }
  } finally {
    process.off("SIGINT", onSigint);
  }
}

function dispatcherTargets(): void {
  const config = requireConfig();
  if (!config) return;
  const out = {
    defaultTarget: config.defaultTarget ?? null,
    targets: config.targets.map((t) => ({
      name: t.name,
      description: t.description,
      ...(t.argv ? { params: placeholders(t.argv) } : {}),
      ...(t.builtin === "claude-session" ? { params: ["cwd"], allowedCwds: t.allowedCwds } : {}),
    })),
  };
  console.log(JSON.stringify(out, null, 2));
}

function placeholders(argv: string[]): string[] {
  const found = new Set<string>();
  for (const arg of argv) for (const m of arg.matchAll(/\{\{(\w+)\}\}/g)) found.add(m[1]!);
  return [...found];
}

// ---- start / stop / status ----

function shq(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

// The kickoff does not start a wait itself: the skill's first step does, so exactly one is armed.
const KICKOFF = "You are the Telegram dispatcher. Load the telegram-dispatcher skill and follow it.";

export function buildDispatcherCommand(config: DispatcherConfig, protocolFile: string): string {
  const claude = [
    shq(expandHome(config.session.claudeBin)),
    shq(KICKOFF),
    "--model",
    shq(config.model),
    // before --allowed-tools: that option is variadic and would swallow anything after it
    ...(config.session.name ? ["--name", shq(config.session.name)] : []),
    "--allowed-tools",
    shq(config.session.allowedTools.join(",")),
    "--append-system-prompt-file",
    shq(protocolFile),
  ].join(" ");
  // A fresh session whenever claude exits: nothing in a session's context is load-bearing.
  return `while :; do ${claude}; sleep 5; done`;
}

async function dispatcherStart(): Promise<void> {
  const config = requireConfig();
  if (!config) return;
  try {
    const status = await oneShot({ op: "status" });
    if (!isError(status) && (status as StatusResponse).dispatcher?.listening) {
      fail(`the dispatcher channel "${config.channel}" already has a listener; not starting a second one`);
      return;
    }
    const tmux = tmuxBin();
    const { tmuxSession: session, window } = config.session;
    const windows = (() => {
      try {
        return execFileSync(tmux, ["list-windows", "-t", session, "-F", "#W"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n");
      } catch {
        return undefined; // no such session
      }
    })();
    if (windows?.includes(window)) {
      fail(`tmux window ${session}:${window} already exists; stop it first with tg dispatcher stop`);
      return;
    }
    mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
    const protocolFile = path.join(stateDir(), "dispatcher-protocol.md");
    writeFileSync(protocolFile, DISPATCHER_PROTOCOL.join("\n") + "\n", { mode: 0o600 });
    const command = buildDispatcherCommand(config, protocolFile);
    const cwd = expandHome(config.session.cwd);
    if (windows === undefined) execFileSync(tmux, ["new-session", "-d", "-s", session, "-n", window, "-c", cwd, command], { stdio: "inherit" });
    else execFileSync(tmux, ["new-window", "-d", "-t", `${session}:`, "-n", window, "-c", cwd, command], { stdio: "inherit" });
    console.log(`started the dispatcher in tmux ${session}:${window} (model ${config.model})`);
  } catch (error) {
    fail((error as Error).message);
  }
}

async function dispatcherStop(): Promise<void> {
  const config = requireConfig();
  if (!config) return;
  try {
    execFileSync(tmuxBin(), ["kill-window", "-t", `${config.session.tmuxSession}:${config.session.window}`], { stdio: "inherit" });
    console.log("stopped the dispatcher window");
  } catch (error) {
    fail((error as Error).message);
  }
}

// Puts a synthetic message in the dispatcher's queue without Telegram, so a new install can be tried end
// to end (wake, route, hand off) while "enabled" is still false. The message is logged like any other.
async function dispatcherTrial(rest: string[]): Promise<void> {
  const text = rest.join(" ").trim();
  if (!text) return fail('usage: tg dispatcher trial "text"');
  if (!requireConfig()) return;
  try {
    const r = await oneShot({ op: "trial", text });
    if (isError(r)) return fail(r.error);
    console.log(JSON.stringify({ status: "queued", id: (r as TrialResponse).id }));
  } catch (error) {
    fail((error as Error).message);
  }
}

async function dispatcherStatus(): Promise<void> {
  try {
    const response = await oneShot({ op: "status" });
    if (isError(response)) return fail(response.error);
    const d = (response as StatusResponse).dispatcher;
    if (d.mode === "off") console.log("dispatcher: off (no dispatcher.json)");
    else if (d.mode === "invalid") console.log(`dispatcher: OFF, dispatcher.json is invalid: ${d.error}`);
    else if (d.mode === "disabled") console.log(`dispatcher: disabled (not routing real messages); a session ${d.listening ? "is" : "is not"} listening on ${d.channel}`);
    else console.log(`dispatcher: on, channel ${d.channel}, ${d.listening ? "listening" : "NOT listening"}, ${d.queued ?? 0} queued`);
  } catch (error) {
    fail((error as Error).message);
  }
}

// ---- tg dispatch ----

interface RunResult {
  ok: boolean;
  stdout: string;
  error?: string;
}

function substitute(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
    if (!(key in values)) throw new Error(`missing value for {{${key}}}`);
    return values[key]!;
  });
}

function messageForTarget(inquiry: Inquiry): string {
  const parts = [inquiry.text ?? ""];
  if (inquiry.replyToQuote) parts.push(`(replying to: "${inquiry.replyToQuote}")${inquiry.replyToChannel ? ` · reply to a notice from channel ${inquiry.replyToChannel}` : ""}`);
  if (inquiry.photoPath) parts.push(`Attachment (photo): ${inquiry.photoPath}`);
  if (inquiry.filePath) parts.push(`Attachment (file): ${inquiry.filePath}`);
  return parts.filter(Boolean).join("\n\n");
}

function runCommand(argv: string[], stdin: string, timeoutMs = 60_000): Promise<RunResult> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(argv[0]!, argv.slice(1), { stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      resolve({ ok: false, stdout: "", error: (error as Error).message });
      return;
    }
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    child.stdin.on("error", () => {});
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, stdout, error: error.message });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve({ ok: true, stdout });
      else resolve({ ok: false, stdout, error: stderr.trim().split("\n")[0] || `exited with ${signal ?? code}` });
    });
    child.stdin.end(stdin);
  });
}

function allowedCwd(target: Target, cwd: string): string | undefined {
  let real: string;
  try {
    real = realpathSync(expandHome(cwd));
  } catch {
    return undefined;
  }
  for (const allowed of target.allowedCwds ?? []) {
    try {
      if (realpathSync(expandHome(allowed)) === real) return real;
    } catch {
      // an allowed directory that does not exist matches nothing
    }
  }
  return undefined;
}

interface DispatchArgs {
  positional: string[];
  inquiry?: string;
  note?: string;
  params: Record<string, string>;
}

function parseDispatchArgs(argv: string[]): DispatchArgs {
  const args: DispatchArgs = { positional: [], params: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--inquiry") args.inquiry = argv[++i];
    else if (a === "--note") args.note = argv[++i];
    else if (a === "--param") {
      const kv = argv[++i] ?? "";
      const eq = kv.indexOf("=");
      if (eq < 1) throw new Error(`--param needs key=value, got "${kv}"`);
      args.params[kv.slice(0, eq)] = kv.slice(eq + 1);
    } else if (a.startsWith("--")) throw new Error(`Unknown argument: ${a}`);
    else args.positional.push(a);
  }
  return args;
}

export async function cmdDispatch(argv: string[]): Promise<void> {
  let args: DispatchArgs;
  try {
    args = parseDispatchArgs(argv);
  } catch (error) {
    return fail((error as Error).message);
  }
  const config = requireConfig();
  if (!config) return;

  if (args.positional[0] === "ask") return dispatchAsk(config, args);
  if (args.positional[0] === "address") return dispatchAddress(config, args);
  if (args.positional[0] === "unreachable") return dispatchUnreachable(config, args);

  const targetName = args.positional[0];
  if (!targetName || !args.inquiry) return fail("usage: tg dispatch <target> --inquiry <id> [--param k=v] [--note TEXT] | tg dispatch ask <id> \"question\"");
  const target = config.targets.find((t) => t.name === targetName);
  if (!target) return fail(`unknown target "${targetName}"; targets: ${config.targets.map((t) => t.name).join(", ") || "(none)"}`);
  const inquiry = findInquiry(readInquiries(), args.inquiry);
  if (!inquiry) return fail(`unknown inquiry ${args.inquiry}`);
  if (!isOpen(inquiry)) return fail(`inquiry ${inquiry.id} is already ${inquiry.state}${inquiry.target ? ` (to ${inquiry.target})` : ""}; not handing it off again`);

  const text = messageForTarget(inquiry);
  const values: Record<string, string> = { ...args.params, name: target.name };
  let result: RunResult;
  try {
    if (target.argv) {
      const argvOut = target.argv.map((a) => substitute(a, values));
      result = await runCommand(argvOut, text);
    } else {
      const cwdParam = args.params.cwd;
      if (!cwdParam) throw new Error("this target needs --param cwd=<directory>");
      const cwd = allowedCwd(target, cwdParam);
      if (!cwd) throw new Error(`cwd "${cwdParam}" is not one of this target's allowedCwds`);
      values.cwd = cwd;
      // Which tmux session the window opens in. Left to tmux, a command run from outside tmux (ssh, cron)
      // picks whichever session was used last, which is not where anyone is looking. So: the session the
      // config names; else, inside tmux, the session of the pane that ran this (no -t); else the default.
      const sessionArgs = config.session.tmuxSessionSet || !process.env.TMUX ? ["-t", `${config.session.tmuxSession}:`] : [];
      result = await runCommand([tmuxBin(), "new-window", "-d", ...sessionArgs, "-c", cwd, "-n", `tg-${inquiry.id.slice(-6)}`, expandHome(config.session.claudeBin), text], "");
      if (result.ok) result.stdout = path.basename(cwd);
    }
  } catch (error) {
    result = { ok: false, stdout: "", error: (error as Error).message };
  }

  const replyTo = inquiry.tgMessageId ?? undefined;
  if (!result.ok) {
    // Short lines, the failure named in bold and the cause in code, so it reads at a glance on a phone.
    const cause = (result.error ?? "unknown error").replace(/[`\n]+/g, " ").slice(0, 200);
    const warning = `**Could not hand this to ${target.name}**\n\`${cause}\`\nThe message is still open.`;
    await oneShot({ op: "notify", level: "warning", body: warning, channel: config.channel, replyToMessageId: replyTo, inquiryId: inquiry.id }).catch(() => {});
    console.log(JSON.stringify({ status: "failed", target: target.name, error: result.error }));
    process.exitCode = 1;
    return;
  }
  const ref = result.stdout.trim().split(/\s+/, 1)[0] ?? "";
  values.stdout1 = ref;
  values.stdout = result.stdout.trim().split("\n")[0] ?? "";
  values.id = inquiry.id;
  values.text = (inquiry.text ?? "").slice(0, 1500);
  values.ref = ref;
  let ack: string;
  let nudge: { to: string; address?: string; message: string; target: string } | undefined;
  try {
    ack = substitute(target.ack, values);
    if (target.nudge) {
      const address = readNudgeState()[target.name]?.address ?? target.nudge.address;
      nudge = { to: target.nudge.to, ...(address ? { address } : {}), message: substitute(target.nudge.template, values), target: target.name };
    }
  } catch (error) {
    ack = `Sent to ${target.name}.`;
    console.error(`ack template problem: ${(error as Error).message}`);
  }
  // The confirmation on its own line; an optional remark after a blank line, in italics.
  const note = args.note?.replace(/[*_`]+/g, "").trim();
  const body = note ? `${ack}\n\n*${note}*` : ack;
  try {
    const sent = await oneShot({ op: "notify", level: "success", body, channel: config.channel, replyToMessageId: replyTo, inquiryId: inquiry.id });
    if (isError(sent)) console.error(`acknowledgement not sent: ${sent.error}`);
    const marked = await oneShot({ op: "inquiry", action: "state", id: inquiry.id, state: "handed_off", target: target.name, ref });
    if (isError(marked)) return fail(`handed off, but could not record it: ${marked.error}`);
  } catch (error) {
    return fail(`handed off, but the daemon could not be reached: ${(error as Error).message}`);
  }
  console.log(JSON.stringify({ status: "handed_off", target: target.name, ref, ack, ...(nudge ? { nudge } : {}) }));
}

async function dispatchAsk(config: DispatcherConfig, args: DispatchArgs): Promise<void> {
  const [, id, question] = args.positional;
  if (!id || !question) return fail('usage: tg dispatch ask <id> "your question"');
  const inquiry = findInquiry(readInquiries(), id);
  if (!inquiry) return fail(`unknown inquiry ${id}`);
  try {
    const sent = await oneShot({ op: "notify", level: "info", body: question, channel: config.channel, replyToMessageId: inquiry.tgMessageId ?? undefined, inquiryId: inquiry.id });
    if (isError(sent)) return fail(sent.error);
    const messageId = (sent as NotifyResponse).messageId;
    if (messageId !== undefined) {
      const marked = await oneShot({ op: "inquiry", action: "asked", id: inquiry.id, tgMessageId: messageId });
      if (isError(marked)) return fail(marked.error);
    }
    console.log(JSON.stringify({ status: "asked", inquiry: inquiry.id }));
  } catch (error) {
    fail((error as Error).message);
  }
}

// ---- tg inquiries ----

function line(i: Inquiry): string {
  const text = (i.text ?? (i.photoPath || i.filePath ? "(attachment)" : "")).replace(/\s+/g, " ").slice(0, 70);
  return `${i.id}  ${i.state.padEnd(10)}  ${i.at}  ${text}`;
}

export async function cmdInquiries(argv: string[]): Promise<void> {
  const sub = argv[0];
  const rest = argv.slice(1);
  try {
    if (sub === "list") {
      let open = false;
      let sinceMs = 0;
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === "--open") open = true;
        else if (rest[i] === "--since") sinceMs = Date.now() - parseDuration(rest[++i] ?? "") * 1000;
        else throw new Error(`Unknown argument: ${rest[i]}`);
      }
      const rows = readInquiries().filter((i) => (!open || isOpen(i)) && Date.parse(i.at) >= sinceMs);
      if (!rows.length) console.log(open ? "no open inquiries" : "no inquiries");
      for (const row of rows) console.log(line(row));
      return;
    }
    if (sub === "show") {
      const inquiry = rest[0] ? findInquiry(readInquiries(), rest[0]) : undefined;
      if (!inquiry) return fail(`unknown inquiry ${rest[0] ?? "(none given)"}`);
      console.log(JSON.stringify(inquiry, null, 2));
      return;
    }
    if (sub === "mark") {
      const id = rest[0];
      const si = rest.indexOf("--state");
      const state = si >= 0 ? rest[si + 1] : undefined;
      if (!id || (state !== "dropped" && state !== "handed_off")) return fail("usage: tg inquiries mark <id> --state dropped|handed_off");
      const r = await oneShot({ op: "inquiry", action: "state", id, state });
      if (isError(r)) return fail(r.error);
      console.log(`marked ${id} ${state}`);
      return;
    }
    if (sub === "revive") {
      const ids = rest[0] === "--all-open" ? readInquiries().filter(isOpen).map((i) => i.id) : rest[0] ? [rest[0]] : [];
      if (!ids.length) return fail("usage: tg inquiries revive <id> | --all-open (nothing to revive)");
      for (const id of ids) {
        const r = await oneShot({ op: "inquiry", action: "revive", id });
        if (isError(r)) return fail(r.error);
        console.log(`revived ${id}${(r as InquiryResponse).revived ? "" : ""}`);
      }
      return;
    }
    fail("usage: tg inquiries list [--open] [--since 7d] | show <id> | mark <id> --state dropped|handed_off | revive <id>|--all-open");
  } catch (error) {
    fail((error as Error).message);
  }
}

// ---- tg doctor ----

function onPath(bin: string): boolean {
  if (bin.includes("/")) return existsSync(expandHome(bin));
  try {
    execFileSync("sh", ["-c", 'command -v "$1"', "sh", bin], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Lines for `tg doctor`: what is wrong with dispatcher.json, if anything.
export function dispatcherDoctor(): string[] {
  const state = readDispatcherConfig();
  if (state.state === "absent") return ["dispatcher: off (no dispatcher.json; bare messages go to whichever session is listening)"];
  if (state.state === "invalid") return [`dispatcher: OFF, dispatcher.json is invalid: ${state.error}`];
  const c = state.config;
  const lines = [`dispatcher: ${c.enabled ? "on" : "disabled"}, channel ${c.channel}, model ${c.model}, ${c.targets.length} target(s), default ${c.defaultTarget ?? "(none)"}`];
  if (!c.defaultTarget) lines.push("  warning: no defaultTarget set");
  if (c.targets.length === 0) lines.push("  warning: no targets; the dispatcher has nowhere to send anything");
  for (const t of c.targets) {
    const bin = t.argv?.[0];
    if (bin && !onPath(bin)) lines.push(`  warning: target "${t.name}": "${bin}" is not on PATH`);
    for (const cwd of t.allowedCwds ?? []) if (!existsSync(expandHome(cwd))) lines.push(`  warning: target "${t.name}": allowed directory ${cwd} does not exist`);
  }
  if (!onPath(c.session.claudeBin)) lines.push(`  warning: \`${c.session.claudeBin}\` was not found, so \`tg dispatcher start\` cannot start a session (a tmux window does not read your shell profile; set session.claudeBin to the full path)`);
  if (!onPath("tmux")) lines.push("  warning: `tmux` is not on PATH, so `tg dispatcher start` cannot start a window");
  return lines;
}

// ---- the nudge address ----
//
// A nudge goes to a session by name. The name can match several sessions and a session's address can
// change when its connection re-registers, so the last address that worked is cached here (not in
// dispatcher.json, which a person edits by hand). The dispatcher tries the cached address, and on a
// stale-address error looks up the live row, sends there, and records it with `tg dispatch address`.
// If no row is live it runs `tg dispatch unreachable`, which tells the user once per outage.

interface NudgeEntry {
  address?: string;
  notifiedAt?: string;
}

function nudgeStateFile(): string {
  return path.join(stateDir(), "nudge-state.json");
}

function readNudgeState(): Record<string, NudgeEntry> {
  try {
    const parsed = JSON.parse(readFileSync(nudgeStateFile(), "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, NudgeEntry>) : {};
  } catch {
    return {};
  }
}

function writeNudgeState(state: Record<string, NudgeEntry>): void {
  mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
  const tmp = `${nudgeStateFile()}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, nudgeStateFile());
}

function nudgeTarget(config: DispatcherConfig, name: string | undefined): Target | undefined {
  const target = config.targets.find((t) => t.name === name);
  if (!target?.nudge) {
    fail(`unknown target, or it has no nudge: ${name ?? "(none given)"}`);
    return undefined;
  }
  return target;
}

function dispatchAddress(config: DispatcherConfig, args: DispatchArgs): void {
  const [, targetName, address] = args.positional;
  const target = nudgeTarget(config, targetName);
  if (!target) return;
  if (!address || !validAddress(address)) return fail("usage: tg dispatch address <target> <address> (printable, up to 200 characters)");
  const state = readNudgeState();
  // A working address ends the outage, so the next one is announced again.
  state[target.name] = { address };
  writeNudgeState(state);
  console.log(JSON.stringify({ status: "recorded", target: target.name, address }));
}

async function dispatchUnreachable(config: DispatcherConfig, args: DispatchArgs): Promise<void> {
  const [, targetName] = args.positional;
  const target = nudgeTarget(config, targetName);
  if (!target) return;
  if (!args.inquiry) return fail("usage: tg dispatch unreachable <target> --inquiry <id>");
  const inquiry = findInquiry(readInquiries(), args.inquiry);
  if (!inquiry) return fail(`unknown inquiry ${args.inquiry}`);
  const state = readNudgeState();
  const entry = state[target.name] ?? {};
  if (entry.notifiedAt) {
    console.log(JSON.stringify({ status: "already_notified", target: target.name, since: entry.notifiedAt }));
    return;
  }
  const ref = inquiry.ref ?? "(no reference)";
  try {
    const sent = await oneShot({ op: "notify", level: "warning", body: `Could not reach ${target.nudge!.to} directly; the item is filed as \`${ref}\`.`, channel: config.channel, replyToMessageId: inquiry.tgMessageId ?? undefined, inquiryId: inquiry.id });
    if (isError(sent)) return fail(sent.error);
  } catch (error) {
    return fail((error as Error).message);
  }
  state[target.name] = { ...entry, notifiedAt: new Date().toISOString() };
  writeNudgeState(state);
  console.log(JSON.stringify({ status: "notified", target: target.name }));
}
