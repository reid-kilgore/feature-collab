// Unix socket daemon: owns the SQLite store and the Telegram poller, and serves the CLI's
// newline-delimited JSON requests. One daemon per laptop (one bot, one getUpdates consumer).

import net from "node:net";
import { unlinkSync, openSync, closeSync, writeFileSync, chmodSync, appendFileSync, readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import {
  socketFile,
  lockFile,
  dbFile,
  logFile,
  getToken,
  readConfig,
  apiBase,
  redact,
  shortHostname,
  ensureDirs,
} from "../config.ts";
import { Store, newId, newShortId } from "../core/store.ts";
import type { QuestionStatus } from "../core/store.ts";
import { TelegramApi, classifyAttachment } from "../transports/telegram/api.ts";
import { createTelegramPort } from "../transports/telegram/handler.ts";
import type { HandlerContext } from "../transports/telegram/handler.ts";
import { Poller } from "../transports/telegram/poller.ts";
import { startBatch, cancelBatch, expireBatch, isBatchTimedOut, buildResult } from "../core/interaction.ts";
import type { OnResolved } from "../core/interaction.ts";
import { validatePayload, ContractError } from "../contract/payload.ts";
import type { AskPayload, AskResult } from "../contract/payload.ts";
import { markdownToTelegramHtml, splitMessage } from "../core/markdown.ts";
import { renderNotification } from "../transports/telegram/render.ts";
import type { DaemonRequest, DaemonResponse, ChannelStatus } from "./protocol.ts";

const SWEEP_INTERVAL_MS = 30000;

function log(line: string): void {
  const stamped = `${new Date().toISOString()} ${redact(line)}\n`;
  try {
    appendFileSync(logFile(), stamped, { mode: 0o600 });
  } catch {
    // ignore logging failures
  }
}

export async function runDaemon(): Promise<void> {
  const config = readConfig();
  if (!config) {
    console.error("No config found. Run `tg setup` first.");
    process.exitCode = 1;
    return;
  }
  const token = getToken();
  if (!token) {
    console.error("No bot token found. Run `tg setup --token <token>` first.");
    process.exitCode = 1;
    return;
  }

  ensureDirs();
  if (!acquireLock()) {
    log("another daemon instance is already running; exiting");
    return;
  }

  const store = new Store(dbFile());
  const api = new TelegramApi(token, apiBase());
  const hostname = shortHostname();
  const port = createTelegramPort(api, hostname);
  const startedAt = new Date();

  const waiters = new Map<string, Array<(result: AskResult) => void>>();
  const onResolved: OnResolved = (batchId, result) => {
    const list = waiters.get(batchId);
    if (list) {
      for (const resolve of list) resolve(result);
      waiters.delete(batchId);
    }
  };

  // `tg recv --wait` listeners: a count (for the 👀 vs 📥 reaction) plus a list of
  // resolvers woken whenever handler.ts records a new inbox message.
  let listeningCount = 0;
  let inboxWaiters: Array<() => void> = [];
  const isListening = () => listeningCount > 0;
  const notifyInbox = () => {
    const list = inboxWaiters;
    inboxWaiters = [];
    for (const resolve of list) resolve();
  };

  // Per-channel activity, for "Inbox routing with several agents": in-memory only (a
  // daemon restart just falls back to "unrouted" until a channel sends or listens again).
  const channelState = new Map<string, { lastSendAt: number; listening: number }>();
  const touchChannel = (channel: string): { lastSendAt: number; listening: number } => {
    let entry = channelState.get(channel);
    if (!entry) {
      entry = { lastSendAt: 0, listening: 0 };
      channelState.set(channel, entry);
    }
    return entry;
  };
  const markSend = (channel: string) => {
    touchChannel(channel).lastSendAt = Date.now();
  };
  const markListen = (channel: string, delta: 1 | -1) => {
    touchChannel(channel).listening += delta;
  };
  // Reply-to routing is tried first by the caller; this covers steps 2-3: prefer a
  // currently-listening channel (ties broken by most recent send), else the channel that
  // most recently sent anything, else undefined (unrouted).
  const pickActiveChannel = (): string | undefined => {
    let bestListening: string | undefined;
    let bestListeningAt = -1;
    let bestAny: string | undefined;
    let bestAnyAt = -1;
    for (const [channel, entry] of channelState) {
      if (entry.listening > 0 && entry.lastSendAt > bestListeningAt) {
        bestListening = channel;
        bestListeningAt = entry.lastSendAt;
      }
      if (entry.lastSendAt > bestAnyAt) {
        bestAny = channel;
        bestAnyAt = entry.lastSendAt;
      }
    }
    return bestListening ?? bestAny;
  };

  const ctx: HandlerContext = {
    store,
    api,
    port,
    onResolved,
    allowed: { chatId: config.chatId, userId: config.userId },
    daemonStartedAt: startedAt,
    isListening,
    notifyInbox,
    channelForMessage: (messageId) => store.getChannelForMessage(messageId),
    pickActiveChannel,
  };

  await recoverOnStartup(store, port, onResolved, log);

  const poller = new Poller(store, api, ctx, log);
  poller.start();

  const sweepTimer = setInterval(() => {
    sweepExpired(store, port, onResolved).catch((error) => log(`sweep error: ${(error as Error).message}`));
  }, SWEEP_INTERVAL_MS);

  const registerInboxWaiter = (resolve: () => void) => {
    inboxWaiters.push(resolve);
  };
  const addListener = (delta: 1 | -1) => {
    listeningCount += delta;
  };

  // Tracked so shutdown() can force-close client connections (an `ask`/`recv --wait`
  // socket left open would otherwise hold the process open past graceful shutdown).
  const openSockets = new Set<net.Socket>();
  let shuttingDown = false;
  const isShuttingDown = () => shuttingDown;

  const server = net.createServer((socket) => {
    openSockets.add(socket);
    socket.once("close", () => openSockets.delete(socket));
    handleConnection(socket, {
      store,
      api,
      port,
      onResolved,
      waiters,
      hostname,
      config,
      startedAt,
      registerInboxWaiter,
      addListener,
      isListening,
      markSend,
      markListen,
      channelState,
      isShuttingDown,
    }).catch((error) => {
      log(`connection error: ${(error as Error).message}`);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketFile(), () => resolve());
  });
  try {
    chmodSync(socketFile(), 0o600);
  } catch {
    // best-effort
  }
  log(`daemon started, bot=${hostname}, socket=${socketFile()}`);

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`received ${signal}, shutting down`);
    // Hard floor: whatever else happens, do not let a stuck poll or socket keep the
    // process (and launchd's restart of it) waiting indefinitely.
    const forceExitTimer = setTimeout(() => {
      log("shutdown grace period elapsed, forcing exit");
      process.exit(0);
    }, 3000);
    forceExitTimer.unref();
    try {
      clearInterval(sweepTimer);
      for (const socket of openSockets) socket.destroy();
      await Promise.race([poller.stop(), sleep(2500)]);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
      releaseLock();
    } catch (error) {
      log(`error during shutdown: ${(error as Error).message}`);
    } finally {
      clearTimeout(forceExitTimer);
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

// Exclusive lock: a lock file holding the owning PID. A second daemon exits immediately
// unless the lock file is stale (holder process no longer alive), in which case it is
// reclaimed. The socket file is removed so a fresh `net.createServer().listen()` doesn't
// collide with a leftover file from a crashed daemon.
function acquireLock(): boolean {
  const takeLock = (): boolean => {
    try {
      const fd = openSync(lockFile(), "wx");
      writeFileSync(fd, String(process.pid));
      closeSync(fd);
      return true;
    } catch {
      return false;
    }
  };

  if (takeLock()) {
    try {
      unlinkSync(socketFile());
    } catch {
      // ignore: no stale socket
    }
    return true;
  }

  try {
    const pid = Number(readFileSync(lockFile(), "utf8").trim());
    if (pid && processAlive(pid)) return false;
  } catch {
    // fallthrough: unreadable lock file, treat as stale
  }
  try {
    unlinkSync(lockFile());
  } catch {
    // ignore
  }
  if (takeLock()) {
    try {
      unlinkSync(socketFile());
    } catch {
      // ignore
    }
    return true;
  }
  return false;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function releaseLock(): void {
  try {
    unlinkSync(lockFile());
  } catch {
    // ignore
  }
  try {
    unlinkSync(socketFile());
  } catch {
    // ignore
  }
}

interface ConnectionDeps {
  store: Store;
  api: TelegramApi;
  port: ReturnType<typeof createTelegramPort>;
  onResolved: OnResolved;
  waiters: Map<string, Array<(result: AskResult) => void>>;
  hostname: string;
  config: { chatId: string; userId: string; botUsername: string };
  startedAt: Date;
  registerInboxWaiter: (resolve: () => void) => void;
  addListener: (delta: 1 | -1) => void;
  isListening: () => boolean;
  markSend: (channel: string) => void;
  markListen: (channel: string, delta: 1 | -1) => void;
  channelState: Map<string, { lastSendAt: number; listening: number }>;
  isShuttingDown: () => boolean;
}

async function handleConnection(socket: net.Socket, deps: ConnectionDeps): Promise<void> {
  let buffer = "";
  let disconnectedBatchId: string | undefined;

  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (!line.trim()) continue;
      void handleLine(line);
    }
  });

  socket.on("close", () => {
    // Only a genuine CLI disconnect cancels the question. A daemon-initiated shutdown
    // (graceful restart) destroys this same socket, but the batch must stay pending so a
    // restarted daemon resumes it and `tg wait <id>` can still re-attach (DESIGN.md: "A
    // batch whose CLI socket is gone after restart stays pending until Reid answers").
    if (disconnectedBatchId && !deps.isShuttingDown()) {
      cancelBatch(deps.store, deps.port, deps.onResolved, disconnectedBatchId).catch(() => {});
    }
  });

  const write = (obj: DaemonResponse) => {
    if (!socket.writable) return;
    socket.write(JSON.stringify(obj) + "\n");
  };

  const handleLine = async (line: string) => {
    let request: DaemonRequest;
    try {
      request = JSON.parse(line);
    } catch {
      write({ error: "invalid JSON request" });
      return;
    }
    try {
      switch (request.op) {
        case "notify": {
          await sendNotification(deps, request);
          write({ ok: true });
          return;
        }
        case "ask": {
          const payload = validatePayload(request.payload);
          const batchId = createAskBatch(deps, payload, request.askerPath, request.askerTmuxWindow, request.timeoutSeconds, request.onTimeout);
          write({ id: batchId });
          const resultPromise = new Promise<AskResult>((resolve) => {
            const list = deps.waiters.get(batchId) ?? [];
            list.push(resolve);
            deps.waiters.set(batchId, list);
          });
          void startBatch(deps.store, deps.port, batchId).catch((error) => log(`startBatch error: ${(error as Error).message}`));
          disconnectedBatchId = batchId;
          const result = await resultPromise;
          disconnectedBatchId = undefined;
          write({ result });
          return;
        }
        case "status": {
          const pending = deps.store.listPendingQuestions();
          const lastOffset = deps.store.getMeta("last_update_at");
          const unreadByChannel = new Map(deps.store.countUnreadInboxByChannel().map((r) => [r.channel, r.count]));
          const channelNames = new Set<string>([...deps.channelState.keys(), ...unreadByChannel.keys()]);
          channelNames.delete("(unrouted)");
          const channels: ChannelStatus[] = [...channelNames].map((channel) => {
            const entry = deps.channelState.get(channel);
            return {
              channel,
              lastSendAgeSeconds: entry && entry.lastSendAt > 0 ? Math.floor((Date.now() - entry.lastSendAt) / 1000) : null,
              listening: (entry?.listening ?? 0) > 0,
              unread: unreadByChannel.get(channel) ?? 0,
            };
          });
          write({
            alive: true,
            botUsername: deps.config.botUsername,
            hostname: deps.hostname,
            allowedUserId: deps.config.userId,
            allowedChatId: deps.config.chatId,
            pendingCount: pending.length,
            lastUpdateAgeSeconds: lastOffset ? Math.floor((Date.now() - Number(lastOffset)) / 1000) : null,
            startedAt: deps.startedAt.toISOString(),
            unreadInbox: deps.store.countUnreadInbox(),
            listening: deps.isListening(),
            channels,
          });
          return;
        }
        case "recv": {
          const channel = request.channel;
          const takeUnread = () => deps.store.listUnreadInboxForChannel(channel);
          let unread = takeUnread();

          if (unread.length === 0 && request.wait) {
            deps.addListener(1);
            deps.markListen(channel, 1);
            const deadline = request.timeoutSeconds ? Date.now() + request.timeoutSeconds * 1000 : undefined;
            // A wake-up can be for another channel's message; keep waiting (against the
            // same overall deadline) until this channel actually has something.
            while (unread.length === 0) {
              const remainingMs = deadline !== undefined ? deadline - Date.now() : undefined;
              if (remainingMs !== undefined && remainingMs <= 0) break;
              const arrived = await new Promise<boolean>((resolve) => {
                let settled = false;
                const onArrive = () => {
                  if (settled) return;
                  settled = true;
                  resolve(true);
                };
                deps.registerInboxWaiter(onArrive);
                if (remainingMs !== undefined) {
                  setTimeout(() => {
                    if (settled) return;
                    settled = true;
                    resolve(false);
                  }, remainingMs);
                }
              });
              if (!arrived) break;
              unread = takeUnread();
            }
            deps.addListener(-1);
            deps.markListen(channel, -1);
            if (unread.length === 0) {
              write({ version: 1, status: "timeout", messages: [] });
              return;
            }
          }

          const messages = unread.map((row) => ({
            id: row.id,
            at: row.at,
            ...(row.text !== null ? { text: row.text } : {}),
            ...(row.photo_path ? { photoPath: row.photo_path } : {}),
            ...(row.file_path ? { filePath: row.file_path } : {}),
          }));
          if (!request.peek) deps.store.consumeInbox(unread.map((r) => r.id));
          write({ version: 1, status: "received", messages });
          return;
        }
        case "pending": {
          const rows = deps.store.listPendingQuestions();
          const items = rows.map((row) => {
            const batch = deps.store.getBatch(row.batch_id)!;
            const payload = JSON.parse(batch.payload_json) as AskPayload;
            const question = payload.questions[row.idx]!;
            return {
              batchId: batch.id,
              questionId: row.id,
              title: payload.title,
              prompt: question.prompt,
              createdAt: row.created_at,
              askerPath: batch.asker_path,
            };
          });
          write({ items });
          return;
        }
        case "cancel": {
          let count = 0;
          if (request.id === "all") {
            for (const batch of deps.store.listPendingBatches()) {
              await cancelBatch(deps.store, deps.port, deps.onResolved, batch.id);
              count++;
            }
          } else {
            const batch = deps.store.getBatch(request.id);
            if (batch && batch.status === "pending") {
              await cancelBatch(deps.store, deps.port, deps.onResolved, request.id);
              count = 1;
            }
          }
          write({ cancelled: count });
          return;
        }
        case "wait": {
          const batch = deps.store.getBatch(request.id);
          if (!batch) {
            write({ error: `unknown batch ${request.id}` });
            return;
          }
          if (batch.result_json) {
            write({ result: JSON.parse(batch.result_json) as AskResult });
            return;
          }
          const resultPromise = new Promise<AskResult>((resolve) => {
            const list = deps.waiters.get(request.id) ?? [];
            list.push(resolve);
            deps.waiters.set(request.id, list);
          });
          disconnectedBatchId = undefined; // reattach does not cancel on disconnect
          const result = await resultPromise;
          write({ result });
          return;
        }
        default:
          write({ error: `unknown op` });
      }
    } catch (error) {
      if (error instanceof ContractError) {
        write({ error: error.message + (error.issues.length ? `: ${JSON.stringify(error.issues)}` : "") });
      } else {
        write({ error: redact((error as Error).message ?? String(error)) });
      }
    }
  };
}

function createAskBatch(
  deps: ConnectionDeps,
  payload: AskPayload,
  askerPath: string,
  askerTmuxWindow: string | undefined,
  timeoutSeconds: number | undefined,
  onTimeout: "cancel" | "default" | undefined,
): string {
  const id = newId();
  const effectiveTimeoutSeconds = timeoutSeconds ?? payload.timeoutSeconds;
  const timeoutAt = effectiveTimeoutSeconds ? new Date(Date.now() + effectiveTimeoutSeconds * 1000).toISOString() : null;
  deps.store.createBatch({
    id,
    status: "pending",
    asker_path: askerPath,
    asker_tmux_window: askerTmuxWindow ?? null,
    payload_json: JSON.stringify(payload),
    timeout_at: timeoutAt,
    on_timeout: onTimeout ?? payload.onTimeout ?? "cancel",
    chat_id: deps.config.chatId,
    user_id: deps.config.userId,
  });
  payload.questions.forEach((_q, idx) => {
    deps.store.createQuestion({
      id: newId(),
      batch_id: id,
      idx,
      short_id: newShortId(),
      status: (idx === 0 ? "waiting" : "waiting") as QuestionStatus,
      selected_json: null,
      text_answer: null,
      message_id: null,
      force_reply_message_id: null,
    });
  });
  deps.store.appendAudit("batch_created", id, null, { askerPath });
  return id;
}

async function sendNotification(
  deps: ConnectionDeps,
  request: {
    level: "info" | "success" | "warning" | "error";
    title?: string;
    body?: string;
    imagePath?: string;
    filePath?: string;
    caption?: string;
    channel: string;
  },
): Promise<void> {
  const bodyHtml = request.body ? markdownToTelegramHtml(request.body) : undefined;
  const text = renderNotification(request.level, deps.hostname, request.title, bodyHtml);

  const recordSent = (messageId: number) => {
    deps.store.recordMessageChannel(messageId, request.channel);
    deps.markSend(request.channel);
  };

  const attachmentPath = request.imagePath ?? request.filePath;
  if (attachmentPath) {
    const { kind } = await classifyAttachment(attachmentPath);
    const captionSource = request.caption ?? request.body;
    const caption = captionSource ? markdownToTelegramHtml(captionSource) : undefined;
    const captionFits = caption !== undefined && caption.length <= 1024;
    const inlineCaption = captionFits ? caption : undefined;
    if (kind === "photo" && request.imagePath) {
      const sent = await deps.api.sendPhoto(deps.config.chatId, request.imagePath, inlineCaption);
      recordSent(sent.message_id);
    } else {
      const sent = await deps.api.sendDocument(deps.config.chatId, attachmentPath, inlineCaption);
      recordSent(sent.message_id);
    }
    if (caption !== undefined && !captionFits) {
      await sendTextWithFallback(deps, caption, recordSent);
    }
    return;
  }

  await sendTextWithFallback(deps, text, recordSent);
}

async function sendTextWithFallback(deps: ConnectionDeps, html: string, recordSent: (messageId: number) => void): Promise<void> {
  const chunks = splitMessage(html);
  for (const chunk of chunks) {
    try {
      const sent = await deps.api.sendMessage(deps.config.chatId, chunk, { html: true });
      recordSent(sent.message_id);
    } catch (error) {
      const message = (error as Error).message ?? "";
      if (message.toLowerCase().includes("parse")) {
        // Formatting must never sink a notification: retry as plain text with tags stripped.
        const plain = chunk.replace(/<[^>]+>/g, "");
        const sent = await deps.api.sendMessage(deps.config.chatId, plain);
        recordSent(sent.message_id);
      } else {
        throw error;
      }
    }
  }
}

async function recoverOnStartup(store: Store, port: ReturnType<typeof createTelegramPort>, onResolved: OnResolved, logFn: (l: string) => void): Promise<void> {
  const pending = store.listPendingBatches();
  for (const batch of pending) {
    if (isBatchTimedOut(batch)) {
      await expireBatch(store, port, onResolved, batch.id);
      continue;
    }
    const questions = store.listQuestionsForBatch(batch.id);
    const live = questions.find((q) => q.status === "pending" || q.status === "awaiting_text");
    if (!live) {
      // Nothing sent yet (crash between insert and send), or a "waiting" head-of-line question.
      try {
        await startBatch(store, port, batch.id);
      } catch (error) {
        logFn(`recovery startBatch failed for ${batch.id}: ${(error as Error).message}`);
      }
    }
  }
}

async function sweepExpired(store: Store, port: ReturnType<typeof createTelegramPort>, onResolved: OnResolved): Promise<void> {
  const pending = store.listPendingBatches();
  for (const batch of pending) {
    if (isBatchTimedOut(batch)) {
      await expireBatch(store, port, onResolved, batch.id);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
