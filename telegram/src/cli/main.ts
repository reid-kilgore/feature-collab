#!/usr/bin/env node
// tg <command> parsing and dispatch.

import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { oneShot, connectToDaemon, sendRequest, readResponses, waitForResult, LostDaemonError } from "./client.ts";
import { runSetup } from "./setup.ts";
import { dispatcherHealthLine } from "../dispatcher/health.ts";
import { cmdDispatcher, cmdDispatch, cmdInquiries, dispatcherDoctor } from "./dispatcher.ts";
import { runDaemon } from "../daemon/server.ts";
import { validatePayload, ContractError } from "../contract/payload.ts";
import type { AskPayload, DocumentInput } from "../contract/payload.ts";
import { extractMarkdownImageRefs, isImagePath } from "../core/diagrams.ts";
import type { Level } from "../contract/notify.ts";
import { parseButtonArg, type LinkButton } from "../core/buttons.ts";
import { readPresence, setPresence, describePresence } from "../presence.ts";
import { getToken, readConfig, configExists, shortHostname, redact, tmuxBin } from "../config.ts";
import type {
  DaemonRequest,
  DaemonResponse,
  AskAcceptedResponse,
  AskResolvedResponse,
  ErrorResponse,
  StatusResponse,
  PendingResponse,
  CancelResponse,
  RecvResponse,
  QuarantineResponse,
} from "../daemon/protocol.ts";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const rest = argv.slice(1);

  switch (command) {
    case "ask":
      await cmdAsk(rest);
      return;
    case "send":
      await cmdSend(rest);
      return;
    case "status":
      await cmdStatus();
      return;
    case "pending":
      await cmdPending(rest);
      return;
    case "cancel":
      await cmdCancel(rest);
      return;
    case "wait":
      await cmdWait(rest);
      return;
    case "recv":
      await cmdRecv(rest);
      return;
    case "dispatcher":
      await cmdDispatcher(rest);
      return;
    case "dispatch":
      await cmdDispatch(rest);
      return;
    case "inquiries":
      await cmdInquiries(rest);
      return;
    case "quarantine":
      await cmdQuarantine(rest);
      return;
    case "presence":
      cmdPresence(rest);
      return;
    case "daemon":
      await runDaemon();
      return;
    case "setup":
      await runSetup(parseSetupArgs(rest));
      return;
    case "doctor":
      await cmdDoctor();
      return;
    default:
      printUsage();
      process.exitCode = command ? 1 : 0;
  }
}

function printUsage(): void {
  console.error(`tg <command> [options]

Commands:
  ask [--file F | --json J | (stdin)] [--timeout DURATION] [--on-timeout cancel|default] [--key KEY] --from ADDRESS
      (--from, AGENT_TELEGRAM_FROM or a tmux session:window is required; exit 2 without one)
  send [TEXT | -] [--level info|success|warning|error] [--title T] [--image PATH] [--file PATH] [--reply-to MESSAGE_ID] [--from ADDRESS]
       [--button "label=url"]... [--no-button]
      (a --button is a tappable link under the message, one per row; with none, a lone http(s) link in the text becomes one
       unless --no-button)
  status
  pending [--json]
  cancel <id|all> | cancel --key KEY
  wait <id>
  recv [--wait] [--timeout DURATION] [--peek] [--channel KEY]
  dispatcher wait | targets | start | stop | status
  dispatch <target> --inquiry ID [--param k=v] [--note TEXT] | dispatch ask ID "question"
  inquiries list [--open] [--since 7d] | show ID | mark ID --state dropped|handed_off | revive ID|--all-open
  quarantine [--dry-run] [--stale-channels [--older DURATION]]
  presence [show] | away [--note TEXT] [--for DURATION|--no-expiry] [--by WHO] | present [--note TEXT] [--by WHO]
  daemon
  setup [--token T] [--chat-id ID]
  doctor`);
}

// ---- ask ----

function parseAskArgs(argv: string[]): { file?: string; json?: string; timeoutSeconds?: number; onTimeout?: "cancel" | "default"; from?: string; key?: string } {
  const result: { file?: string; json?: string; timeoutSeconds?: number; onTimeout?: "cancel" | "default"; from?: string; key?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--file") result.file = argv[++i];
    else if (arg === "--json") result.json = argv[++i];
    else if (arg === "--from") result.from = argv[++i];
    else if (arg === "--key") result.key = argv[++i];
    else if (arg === "--timeout") result.timeoutSeconds = parseDuration(argv[++i] ?? "");
    else if (arg === "--on-timeout") {
      const v = argv[++i];
      if (v !== "cancel" && v !== "default") throw new Error("--on-timeout must be cancel or default");
      result.onTimeout = v;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return result;
}

function parseDuration(text: string): number {
  const match = /^(\d+)(s|m|h|d)?$/.exec(text.trim());
  if (!match) throw new Error(`Invalid duration: ${text}`);
  const value = Number(match[1]);
  const unit = match[2] ?? "s";
  const multiplier = { s: 1, m: 60, h: 3600, d: 86400 }[unit]!;
  return value * multiplier;
}

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function cmdAsk(argv: string[]): Promise<void> {
  let args: ReturnType<typeof parseAskArgs>;
  try {
    args = parseAskArgs(argv);
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
    return;
  }

  // A question nobody can be asked about later is refused: the dispatcher's sweep and a cancel
  // both need to know who asked.
  const askerAddress = cleanSender(args.from ?? process.env.AGENT_TELEGRAM_FROM) ?? tmuxAddress();
  if (!askerAddress) {
    console.error("tg ask needs a sender address: pass --from SESSION:WINDOW or set AGENT_TELEGRAM_FROM (a tmux session:window is used automatically inside tmux).");
    process.exitCode = 2;
    return;
  }
  if (!askerAddress.includes(":")) {
    console.error(`tg ask: the sender address "${askerAddress}" has no colon. Use SESSION:WINDOW (for example the output of tmux display-message -p '#S:#W'); a bare name cannot be looked up reliably when the dispatcher needs to reach the asker.`);
    process.exitCode = 2;
    return;
  }
  if (args.key !== undefined && !args.key.trim()) {
    console.error("--key needs a non-empty value");
    process.exitCode = 1;
    return;
  }

  let raw: string;
  let baseDir: string;
  if (args.file) {
    raw = readFileSync(args.file, "utf8");
    baseDir = path.dirname(path.resolve(args.file));
  } else if (args.json !== undefined) {
    raw = args.json;
    baseDir = process.cwd();
  } else {
    raw = await readAllStdin();
    baseDir = process.cwd();
  }

  let payload: AskPayload;
  try {
    const parsed = JSON.parse(raw);
    payload = validatePayload(parsed);
  } catch (error) {
    if (error instanceof ContractError) {
      console.error(`Invalid payload: ${error.message}`);
      for (const issue of error.issues) console.error(`  ${issue.location}: ${issue.message}`);
    } else {
      console.error(`Invalid JSON: ${(error as Error).message}`);
    }
    process.exitCode = 1;
    return;
  }

  if (payload.documents?.length) {
    try {
      payload = { ...payload, documents: resolveDocuments(payload.documents, baseDir) };
    } catch (error) {
      console.error((error as Error).message);
      process.exitCode = 1;
      return;
    }
  }

  if (args.key !== undefined) payload = { ...payload, key: args.key.trim() };

  const askerPath = process.cwd();
  const askerTmuxWindow = bestEffortTmuxWindow();

  const request: DaemonRequest = {
    op: "ask",
    payload,
    askerPath,
    askerTmuxWindow,
    askerAddress,
    timeoutSeconds: args.timeoutSeconds,
    onTimeout: args.onTimeout,
  };

  let socket;
  try {
    socket = await connectToDaemon();
  } catch (error) {
    console.error(redact((error as Error).message));
    process.exitCode = 1;
    return;
  }

  let batchId: string | undefined;
  let settled = false;

  const onSigint = () => {
    if (batchId && !settled) {
      const cancelSocket = socket;
      sendRequest(cancelSocket, { op: "cancel", id: batchId });
      console.error("\nCancelled.");
    }
    process.exit(2);
  };
  process.on("SIGINT", onSigint);

  await new Promise<void>((resolve) => {
    readResponses(
      socket,
      (response: DaemonResponse) => {
        if ("id" in response) {
          batchId = (response as AskAcceptedResponse).id;
          console.error(`Question id: ${batchId} (use \`tg wait ${batchId}\` to re-attach after a timeout)`);
          return;
        }
        if ("result" in response) {
          settled = true;
          const result = (response as AskResolvedResponse).result;
          process.stdout.write(JSON.stringify(result) + "\n");
          if (result.status === "submitted") process.exitCode = 0;
          else process.exitCode = 2;
          socket.end();
          resolve();
          return;
        }
        if ("error" in response) {
          settled = true;
          console.error(redact((response as ErrorResponse).error));
          process.exitCode = 1;
          socket.end();
          resolve();
        }
      },
      () => resolve(),
    );
    sendRequest(socket, request);
  });
  process.off("SIGINT", onSigint);
  if (!settled) {
    // The connection ended with no result: the daemon went away (a restart). The question is stored, so
    // re-attach and wait for it. Never end as if nothing happened: that reads as a success with no answer.
    if (!batchId) {
      console.error("the daemon went away before it accepted the question; nothing was asked. Run the command again once it is back.");
      process.exitCode = 3;
      return;
    }
    try {
      const result = await waitForResult(batchId);
      process.stdout.write(JSON.stringify(result) + "\n");
      process.exitCode = result.status === "submitted" ? 0 : 2;
    } catch (error) {
      console.error(redact((error as Error).message));
      process.exitCode = error instanceof LostDaemonError ? 3 : 1;
    }
  }
}

// Resolves a path the agent gave (relative to `from`) to a real file inside baseDir.
// Refuses absolute paths, "..", and symlinks that leave baseDir.
function resolveInside(baseDir: string, rel: string, from: string, label: string): string {
  if (path.isAbsolute(rel)) throw new Error(`${label}: path must be relative`);
  const realBase = realpathSync(baseDir);
  const resolved = path.resolve(realpathSync(from), rel);
  const outside = (relative: string) => relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative);
  if (outside(path.relative(realBase, resolved))) throw new Error(`${label}: path must stay within ${baseDir}`);
  let realResolved: string;
  try {
    realResolved = realpathSync(resolved);
  } catch {
    throw new Error(`${label}: file not found: ${rel}`);
  }
  if (outside(path.relative(realBase, realResolved))) throw new Error(`${label}: path must stay within ${baseDir} (symlink check)`);
  return realResolved;
}

function resolveDocuments(documents: DocumentInput[], baseDir: string): DocumentInput[] {
  return documents.map((doc) => {
    const label = `document ${doc.id}`;
    let markdown: string;
    let docDir = baseDir;
    if (doc.markdown !== undefined) {
      markdown = doc.markdown;
    } else {
      if (!doc.path) throw new Error(`${label} has neither markdown nor path`);
      const realResolved = resolveInside(baseDir, doc.path, baseDir, label);
      // An image path is sent as a photo; the daemon gets the checked absolute path.
      if (isImagePath(realResolved)) return { id: doc.id, title: doc.title, path: realResolved };
      markdown = readFileSync(realResolved, "utf8");
      docDir = path.dirname(realResolved);
    }
    const images = extractMarkdownImageRefs(markdown).map((ref) => resolveInside(baseDir, ref, docDir, `${label} image ${ref}`));
    return { id: doc.id, title: doc.title, markdown, ...(images.length ? { images } : {}) };
  });
}

function bestEffortTmuxWindow(): string | undefined {
  if (!process.env.TMUX) return undefined;
  try {
    return execFileSync("tmux", ["display-message", "-p", "#W"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || undefined;
  } catch {
    return undefined;
  }
}

// ---- send ----

// Channel key for inbox routing with several agents sharing one daemon (DESIGN.md "Inbox
// routing with several agents"): --channel flag, else AGENT_TELEGRAM_CHANNEL, else the
// tmux pane (so each pane is its own channel), else the absolute cwd.
function resolveChannel(explicit: string | undefined): string {
  if (explicit) return explicit;
  if (process.env.AGENT_TELEGRAM_CHANNEL) return process.env.AGENT_TELEGRAM_CHANNEL;
  if (process.env.TMUX_PANE) return process.env.TMUX_PANE;
  return process.cwd();
}

// The sender's tmux address, session:window, asked of the sender's own pane. Undefined outside tmux or
// when tmux does not answer.
function tmuxAddress(): string | undefined {
  if (!process.env.TMUX) return undefined;
  try {
    const pane = process.env.TMUX_PANE ? ["-t", process.env.TMUX_PANE] : [];
    return cleanSender(execFileSync(tmuxBin(), ["display-message", "-p", ...pane, "#S:#W"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    return undefined;
  }
}

// An address a caller passed is shown to Reid: drop control characters, cap the length.
function cleanSender(text: string | undefined): string | undefined {
  const cleaned = (text ?? "").replace(/[\u0000-\u001f\u007f]+/g, "").trim().slice(0, 80);
  return cleaned || undefined;
}

// Who sent a message, for the italic last line. An address the caller passed (--from, or
// AGENT_TELEGRAM_FROM, for a caller that reaches this machine over ssh and so has no TMUX here) wins.
// Next the sender's own tmux address, whenever it is in tmux. Outside tmux, only when the sender gave a
// title or a channel: the channel (a path by its last directory, a bare pane id not at all).
function senderName(args: { from?: string; channel?: string; title?: string }): string | undefined {
  const given = cleanSender(args.from ?? process.env.AGENT_TELEGRAM_FROM);
  if (given) return given;
  const address = tmuxAddress();
  if (address) return address;
  const channel = args.channel ?? process.env.AGENT_TELEGRAM_CHANNEL;
  if (!args.title && !channel) return undefined;
  if (!channel || /^%\d+$/.test(channel)) return undefined;
  if (channel.startsWith("/")) return path.basename(channel) || undefined;
  return channel;
}

function parseSendArgs(argv: string[]): {
  text?: string;
  level: Level;
  title?: string;
  imagePath?: string;
  filePath?: string;
  stdin: boolean;
  channel?: string;
  replyToMessageId?: number;
  from?: string;
  buttons: LinkButton[];
  noButton: boolean;
} {
  let level: Level = "info";
  let title: string | undefined;
  let imagePath: string | undefined;
  let filePath: string | undefined;
  let stdin = false;
  let channel: string | undefined;
  let replyToMessageId: number | undefined;
  let from: string | undefined;
  const buttons: LinkButton[] = [];
  let noButton = false;
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--button") {
      buttons.push(parseButtonArg(argv[++i] ?? ""));
    } else if (arg === "--no-button") {
      noButton = true;
    } else if (arg === "--level") {
      const v = argv[++i];
      if (v !== "info" && v !== "success" && v !== "warning" && v !== "error") throw new Error("--level must be info, success, warning, or error");
      level = v;
    } else if (arg === "--title") {
      title = argv[++i];
    } else if (arg === "--image") {
      imagePath = argv[++i];
    } else if (arg === "--file") {
      filePath = argv[++i];
    } else if (arg === "--channel") {
      channel = argv[++i];
    } else if (arg === "--from") {
      from = argv[++i];
    } else if (arg === "--reply-to") {
      replyToMessageId = Number(argv[++i]);
      if (!Number.isInteger(replyToMessageId) || replyToMessageId <= 0) throw new Error("--reply-to needs a Telegram message id");
    } else if (arg === "-") {
      stdin = true;
    } else {
      positional.push(arg!);
    }
  }
  return { text: positional.length ? positional.join(" ") : undefined, level, title, imagePath, filePath, stdin, channel, replyToMessageId, from, buttons, noButton };
}

async function cmdSend(argv: string[]): Promise<void> {
  let args: ReturnType<typeof parseSendArgs>;
  try {
    args = parseSendArgs(argv);
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
    return;
  }

  let body = args.text;
  let caption: string | undefined;
  if (args.stdin) body = await readAllStdin();

  if (args.imagePath || args.filePath) caption = body;

  const request: DaemonRequest = {
    op: "notify",
    level: args.level,
    title: args.title,
    body: args.imagePath || args.filePath ? undefined : body,
    imagePath: args.imagePath,
    filePath: args.filePath,
    caption,
    channel: resolveChannel(args.channel),
    replyToMessageId: args.replyToMessageId,
    sender: senderName(args),
    ...(args.buttons.length ? { buttons: args.buttons } : {}),
    ...(args.noButton ? { noButton: true } : {}),
  };

  if (!request.body && !request.imagePath && !request.filePath) {
    console.error("Nothing to send: provide text, --image, or --file.");
    process.exitCode = 1;
    return;
  }

  try {
    const response = await oneShot(request);
    if ("error" in response) {
      console.error(redact((response as ErrorResponse).error));
      process.exitCode = 1;
      return;
    }
    process.exitCode = 0;
  } catch (error) {
    console.error(redact((error as Error).message));
    process.exitCode = 1;
  }
}

// ---- status / pending / cancel / wait ----

async function cmdStatus(): Promise<void> {
  try {
    const response = await oneShot({ op: "status" });
    if ("error" in response) {
      console.error(redact((response as ErrorResponse).error));
      process.exitCode = 1;
      return;
    }
    const status = response as StatusResponse;
    console.log(`host: ${status.hostname}`);
    console.log(`bot: @${status.botUsername}`);
    console.log(`allowed chat: ${status.allowedChatId}  user: ${status.allowedUserId}`);
    console.log(`pending questions: ${status.pendingCount}`);
    console.log(`unread inbox: ${status.unreadInbox}`);
    console.log(`listening: ${status.listening}`);
    console.log(`last update: ${status.lastUpdateAgeSeconds === null ? "never" : `${status.lastUpdateAgeSeconds}s ago`}`);
    console.log(`daemon started: ${status.startedAt}`);
    console.log(describePresence(readPresence()));
    const d = status.dispatcher;
    if (d) {
      if (d.mode === "off") console.log("dispatcher: off");
      else if (d.mode === "invalid") console.log(`dispatcher: OFF (dispatcher.json invalid: ${d.error})`);
      else if (d.mode === "disabled") console.log(`dispatcher: disabled (not routing real messages); a session ${d.listening ? "is" : "is not"} listening on ${d.channel}`);
      else console.log(`dispatcher: on, channel ${d.channel}, ${d.listening ? "listening" : "NOT listening"}, ${d.queued ?? 0} queued`);
      const health = dispatcherHealthLine(d);
      if (health) console.log(health);
    }
    const ts = status.tailscale;
    if (!ts || ts.mode === "off") console.log("tailscale: off (no tailscale.json)");
    else for (const row of ts.rows ?? []) {
      const probed = row.ageSeconds === null ? "not probed yet" : `probed ${row.ageSeconds}s ago`;
      const word = row.state === "needs_check" ? "NEEDS APPROVAL" : row.state;
      console.log(`tailscale: ${row.pair} ${word}, ${probed}${row.lastResult && row.lastResult !== "ok" && row.ageSeconds !== null ? ` (${row.lastResult})` : ""}`);
    }
    if (status.channels.length) {
      console.log("channels:");
      for (const c of status.channels) {
        const age = c.lastSendAgeSeconds === null ? "never sent" : `sent ${c.lastSendAgeSeconds}s ago`;
        console.log(`  ${c.channel}  ${age}  listening=${c.listening}  unread=${c.unread}`);
      }
    }
  } catch (error) {
    console.error(redact((error as Error).message));
    process.exitCode = 1;
  }
}

// ---- presence ----

// `tg presence away --note "commuting, use Telegram"` is what a session runs when Reid says he is
// leaving; `tg presence present` when he says he is back (a UserPromptSubmit hook does the same
// on his next typed turn). The time always comes from the clock.
function cmdPresence(argv: string[]): void {
  const sub = argv[0] ?? "show";
  const rest = argv.slice(1);
  if (sub === "show") {
    const reading = readPresence();
    if (rest.includes("--json")) console.log(JSON.stringify({ state: reading.state, reason: reading.reason, record: reading.record }));
    else console.log(describePresence(reading));
    return;
  }
  if (sub !== "away" && sub !== "present") {
    console.error("usage: tg presence [show [--json]] | away [--note TEXT] [--for DURATION | --no-expiry] [--by WHO] | present [--note TEXT] [--by WHO]");
    process.exitCode = 1;
    return;
  }
  try {
    let note: string | undefined;
    let setBy: string | undefined;
    let forSeconds: number | null | undefined;
    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i];
      if (arg === "--note") note = rest[++i];
      else if (arg === "--by") setBy = rest[++i];
      else if (arg === "--for" && sub === "away") forSeconds = parseDuration(rest[++i] ?? "");
      else if (arg === "--no-expiry" && sub === "away") forSeconds = null;
      else throw new Error(`Unknown argument: ${arg}`);
    }
    const record = setPresence({ state: sub, note, setBy, forSeconds });
    console.log(describePresence({ state: record.state, reason: "recorded", record }));
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}

async function cmdPending(argv: string[]): Promise<void> {
  const json = argv.includes("--json");
  if (argv.some((a) => a !== "--json")) {
    console.error("Usage: tg pending [--json]");
    process.exitCode = 1;
    return;
  }
  try {
    const response = await oneShot({ op: "pending" });
    if ("error" in response) {
      console.error(redact((response as ErrorResponse).error));
      process.exitCode = 1;
      return;
    }
    const { items, batches } = response as PendingResponse;
    if (json) {
      console.log(JSON.stringify(batches));
      return;
    }
    if (!items.length) {
      console.log("No pending questions.");
      return;
    }
    for (const item of items) {
      console.log(`${item.batchId}  ${item.title ?? "(no title)"}  ${item.prompt}  asked from ${item.askerPath}  at ${item.createdAt}  sender ${item.sender ?? "(none)"}  key ${item.key ?? "(none)"}`);
    }
  } catch (error) {
    console.error(redact((error as Error).message));
    process.exitCode = 1;
  }
}

async function cmdCancel(argv: string[]): Promise<void> {
  const byKey = argv[0] === "--key";
  const id = argv[0];
  if (!id || (byKey && (!argv[1] || argv.length > 2))) {
    console.error("Usage: tg cancel <id|all> | tg cancel --key KEY");
    process.exitCode = 1;
    return;
  }
  try {
    const response = await oneShot(byKey ? { op: "cancel", key: argv[1]! } : { op: "cancel", id });
    if ("error" in response) {
      console.error(redact((response as ErrorResponse).error));
      process.exitCode = 1;
      return;
    }
    if (byKey) console.log(JSON.stringify({ cancelled: (response as CancelResponse).ids ?? [] }));
    else console.log(`Cancelled ${(response as CancelResponse).cancelled} batch(es).`);
  } catch (error) {
    console.error(redact((error as Error).message));
    process.exitCode = 1;
  }
}

async function cmdWait(argv: string[]): Promise<void> {
  const id = argv[0];
  if (!id) {
    console.error("Usage: tg wait <id>");
    process.exitCode = 1;
    return;
  }
  try {
    const result = await waitForResult(id);
    process.stdout.write(JSON.stringify(result) + "\n");
    process.exitCode = result.status === "submitted" ? 0 : 2;
  } catch (error) {
    console.error(redact((error as Error).message));
    process.exitCode = error instanceof LostDaemonError ? 3 : 1;
  }
}

// ---- recv ----

function parseRecvArgs(argv: string[]): { wait: boolean; peek: boolean; timeoutSeconds?: number; channel?: string } {
  let wait = false;
  let peek = false;
  let timeoutSeconds: number | undefined;
  let channel: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--wait") wait = true;
    else if (arg === "--peek") peek = true;
    else if (arg === "--timeout") timeoutSeconds = parseDuration(argv[++i] ?? "");
    else if (arg === "--channel") channel = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return { wait, peek, timeoutSeconds, channel };
}

async function cmdRecv(argv: string[]): Promise<void> {
  let args: ReturnType<typeof parseRecvArgs>;
  try {
    args = parseRecvArgs(argv);
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
    return;
  }

  const onSigint = () => {
    process.stdout.write(JSON.stringify({ version: 1, status: "timeout", messages: [] }) + "\n");
    process.exit(2);
  };
  process.on("SIGINT", onSigint);

  try {
    const response = await oneShot({ op: "recv", wait: args.wait, peek: args.peek, timeoutSeconds: args.timeoutSeconds, channel: resolveChannel(args.channel) });
    if ("error" in response) {
      console.error(redact((response as ErrorResponse).error));
      process.exitCode = 1;
      return;
    }
    const recv = response as RecvResponse;
    process.stdout.write(JSON.stringify(recv) + "\n");
    process.exitCode = recv.status === "received" ? 0 : 2;
  } catch (error) {
    console.error(redact((error as Error).message));
    process.exitCode = 1;
  } finally {
    process.off("SIGINT", onSigint);
  }
}

// ---- quarantine ----

// Unrouted unread messages reach whichever session runs `tg recv` next, however old they are.
// This moves them into the inquiry log (state "legacy") and marks them consumed. Messages bound to
// a channel are left alone.
async function cmdQuarantine(argv: string[]): Promise<void> {
  let dryRun = false;
  let stale = false;
  let olderSeconds: number | undefined;
  try {
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (a === "--dry-run") dryRun = true;
      else if (a === "--stale-channels") stale = true;
      else if (a === "--older") olderSeconds = parseDuration(argv[++i] ?? "");
      else throw new Error(`Unknown argument: ${a}`);
    }
    if (olderSeconds !== undefined && !stale) throw new Error("--older only applies with --stale-channels");
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
    return;
  }
  try {
    const response = await oneShot({ op: "quarantine", dryRun, ...(stale ? { staleChannels: true, olderSeconds: olderSeconds ?? 86400 } : {}) });
    if ("error" in response) {
      console.error(redact((response as ErrorResponse).error));
      process.exitCode = 1;
      return;
    }
    const { quarantined, byChannel } = response as QuarantineResponse;
    if (stale) {
      console.log(dryRun ? `dry run: ${quarantined} unread message(s) on stale channels would be quarantined` : `quarantined ${quarantined} unread message(s) on stale channels`);
      for (const c of byChannel ?? []) console.log(`  ${c.channel.padEnd(40)} ${String(c.count).padStart(3)}  oldest ${c.oldest}`);
    } else {
      console.log(dryRun ? `dry run: ${quarantined} unrouted unread message(s) would be quarantined` : `quarantined ${quarantined} unrouted unread message(s)`);
    }
  } catch (error) {
    console.error(redact((error as Error).message));
    process.exitCode = 1;
  }
}

// ---- doctor ----

function parseSetupArgs(argv: string[]): { token?: string; chatId?: string; userId?: string } {
  const result: { token?: string; chatId?: string; userId?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--token") result.token = argv[++i];
    else if (arg === "--chat-id") result.chatId = argv[++i];
    else if (arg === "--user-id") result.userId = argv[++i];
  }
  return result;
}

async function cmdDoctor(): Promise<void> {
  console.log(`host: ${shortHostname()}`);
  console.log(`token present: ${Boolean(getToken())}`);
  console.log(`config present: ${configExists()}`);
  const config = readConfig();
  if (config) {
    console.log(`config: chatId=${config.chatId} userId=${config.userId} bot=@${config.botUsername}`);
  }
  for (const line of dispatcherDoctor()) console.log(line);
  try {
    const response = await oneShot({ op: "status" });
    if ("error" in response) {
      console.log(`daemon: error: ${redact((response as ErrorResponse).error)}`);
    } else {
      const status = response as StatusResponse;
      console.log(`daemon: alive, bot=@${status.botUsername}, pending=${status.pendingCount}`);
      const health = status.dispatcher ? dispatcherHealthLine(status.dispatcher) : undefined;
      if (health) console.log(health);
      if (config && config.botUsername !== status.botUsername) {
        console.log(`WARNING: config bot (@${config.botUsername}) does not match daemon bot (@${status.botUsername})`);
      }
    }
  } catch (error) {
    console.log(`daemon: unreachable: ${redact((error as Error).message)}`);
  }
}

main().catch((error) => {
  console.error(redact((error as Error).stack ?? String(error)));
  process.exitCode = 1;
});
