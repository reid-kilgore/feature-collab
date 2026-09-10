#!/usr/bin/env node
// tg <command> parsing and dispatch.

import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { oneShot, connectToDaemon, sendRequest, readResponses } from "./client.ts";
import { runSetup } from "./setup.ts";
import { runDaemon } from "../daemon/server.ts";
import { validatePayload, ContractError } from "../contract/payload.ts";
import type { AskPayload, DocumentInput } from "../contract/payload.ts";
import type { Level } from "../contract/notify.ts";
import { getToken, readConfig, configExists, shortHostname, redact } from "../config.ts";
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
      await cmdPending();
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
  ask [--file F | --json J | (stdin)] [--timeout DURATION] [--on-timeout cancel|default]
  send [TEXT | -] [--level info|success|warning|error] [--title T] [--image PATH] [--file PATH]
  status
  pending
  cancel <id|all>
  wait <id>
  recv [--wait] [--timeout DURATION] [--peek] [--channel KEY]
  daemon
  setup [--token T] [--chat-id ID]
  doctor`);
}

// ---- ask ----

function parseAskArgs(argv: string[]): { file?: string; json?: string; timeoutSeconds?: number; onTimeout?: "cancel" | "default" } {
  const result: { file?: string; json?: string; timeoutSeconds?: number; onTimeout?: "cancel" | "default" } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--file") result.file = argv[++i];
    else if (arg === "--json") result.json = argv[++i];
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

  const askerPath = process.cwd();
  const askerTmuxWindow = bestEffortTmuxWindow();

  const request: DaemonRequest = {
    op: "ask",
    payload,
    askerPath,
    askerTmuxWindow,
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
}

interface ResolvedDocument extends DocumentInput {
  markdown: string;
  path?: undefined;
}

function resolveDocuments(documents: DocumentInput[], baseDir: string): DocumentInput[] {
  return documents.map((doc) => {
    if (doc.markdown !== undefined) return doc;
    if (!doc.path) throw new Error(`document ${doc.id} has neither markdown nor path`);
    if (path.isAbsolute(doc.path)) throw new Error(`document ${doc.id}: path must be relative`);
    const resolved = path.resolve(baseDir, doc.path);
    const relative = path.relative(baseDir, resolved);
    if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
      throw new Error(`document ${doc.id}: path must stay within ${baseDir}`);
    }
    const realBase = realpathSync(baseDir);
    const realResolved = realpathSync(resolved);
    const realRelative = path.relative(realBase, realResolved);
    if (realRelative.startsWith(`..${path.sep}`) || realRelative === ".." || path.isAbsolute(realRelative)) {
      throw new Error(`document ${doc.id}: path must stay within ${baseDir} (symlink check)`);
    }
    const markdown = readFileSync(realResolved, "utf8");
    return { id: doc.id, title: doc.title, markdown } satisfies ResolvedDocument;
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

function parseSendArgs(argv: string[]): {
  text?: string;
  level: Level;
  title?: string;
  imagePath?: string;
  filePath?: string;
  stdin: boolean;
  channel?: string;
} {
  let level: Level = "info";
  let title: string | undefined;
  let imagePath: string | undefined;
  let filePath: string | undefined;
  let stdin = false;
  let channel: string | undefined;
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--level") {
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
    } else if (arg === "-") {
      stdin = true;
    } else {
      positional.push(arg!);
    }
  }
  return { text: positional.length ? positional.join(" ") : undefined, level, title, imagePath, filePath, stdin, channel };
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

async function cmdPending(): Promise<void> {
  try {
    const response = await oneShot({ op: "pending" });
    if ("error" in response) {
      console.error(redact((response as ErrorResponse).error));
      process.exitCode = 1;
      return;
    }
    const { items } = response as PendingResponse;
    if (!items.length) {
      console.log("No pending questions.");
      return;
    }
    for (const item of items) {
      console.log(`${item.batchId}  ${item.title ?? "(no title)"}  ${item.prompt}  asked from ${item.askerPath}  at ${item.createdAt}`);
    }
  } catch (error) {
    console.error(redact((error as Error).message));
    process.exitCode = 1;
  }
}

async function cmdCancel(argv: string[]): Promise<void> {
  const id = argv[0];
  if (!id) {
    console.error("Usage: tg cancel <id|all>");
    process.exitCode = 1;
    return;
  }
  try {
    const response = await oneShot({ op: "cancel", id });
    if ("error" in response) {
      console.error(redact((response as ErrorResponse).error));
      process.exitCode = 1;
      return;
    }
    console.log(`Cancelled ${(response as CancelResponse).cancelled} batch(es).`);
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
    const socket = await connectToDaemon();
    await new Promise<void>((resolve) => {
      readResponses(
        socket,
        (response) => {
          if ("result" in response) {
            const result = (response as AskResolvedResponse).result;
            process.stdout.write(JSON.stringify(result) + "\n");
            process.exitCode = result.status === "submitted" ? 0 : 2;
          } else if ("error" in response) {
            console.error(redact((response as ErrorResponse).error));
            process.exitCode = 1;
          }
          socket.end();
          resolve();
        },
        () => resolve(),
      );
      sendRequest(socket, { op: "wait", id });
    });
  } catch (error) {
    console.error(redact((error as Error).message));
    process.exitCode = 1;
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
  try {
    const response = await oneShot({ op: "status" });
    if ("error" in response) {
      console.log(`daemon: error: ${redact((response as ErrorResponse).error)}`);
    } else {
      const status = response as StatusResponse;
      console.log(`daemon: alive, bot=@${status.botUsername}, pending=${status.pendingCount}`);
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
