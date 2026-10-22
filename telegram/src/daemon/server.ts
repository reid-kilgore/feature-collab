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
  resolveMiniapp,
  apiBase,
  redact,
  shortHostname,
  ensureDirs,
} from "../config.ts";
import { Store, newId, newShortId } from "../core/store.ts";
import { appendInquiry, entryFromInboxRow, findInquiry, readInquiries } from "../core/inquiry-log.ts";
import { activeDispatcher, readDispatcherConfig, validDispatcher } from "../dispatcher/config.ts";
import { BOT_COMMANDS_INBOX } from "../transports/telegram/handler.ts";
import { REACTION_HANDED_OFF } from "../transports/telegram/reactions.ts";
import type { QuestionStatus } from "../core/store.ts";
import { TelegramApi, classifyAttachment } from "../transports/telegram/api.ts";
import { createTelegramPort, BOT_COMMANDS, OPEN_COMMAND } from "../transports/telegram/handler.ts";
import type { HandlerContext } from "../transports/telegram/handler.ts";
import { Poller } from "../transports/telegram/poller.ts";
import { startBatch, cancelBatch, expireBatch, isBatchTimedOut, buildResult, advanceOrFinish } from "../core/interaction.ts";
import type { OnResolved } from "../core/interaction.ts";
import { validatePayload, ContractError } from "../contract/payload.ts";
import type { AskPayload, AskResult } from "../contract/payload.ts";
import { markdownToTelegramHtml, splitMessage } from "../core/markdown.ts";
import { renderNotification } from "../transports/telegram/render.ts";
import { createMiniappServer, listenLoopback } from "../miniapp/server.ts";
import { createMenuCountUpdater } from "../miniapp/menu-count.ts";
import { listView } from "../miniapp/views.ts";
import type { DaemonRequest, DaemonResponse, ChannelStatus, DispatcherStatus } from "./protocol.ts";

interface ChannelEntry {
  lastSendAt: number;
  listening: number;
  // When the last listener on this channel went away (0 = never), for "is this channel live".
  lastListenEndAt: number;
}

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
  // Set once the Mini App is running; a no-op until then.
  let menuChanged = () => {};
  const onResolved: OnResolved = (batchId, result) => {
    menuChanged();
    const list = waiters.get(batchId);
    if (list) {
      for (const resolve of list) resolve(result);
      waiters.delete(batchId);
    }
  };

  // `tg recv --wait` listeners: a count (for the 👀 vs ✍ reaction) plus a list of
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
  const channelState = new Map<string, ChannelEntry>();
  const touchChannel = (channel: string): ChannelEntry => {
    let entry = channelState.get(channel);
    if (!entry) {
      entry = { lastSendAt: 0, listening: 0, lastListenEndAt: 0 };
      channelState.set(channel, entry);
    }
    return entry;
  };
  const markSend = (channel: string) => {
    touchChannel(channel).lastSendAt = Date.now();
  };
  // The dispatcher being down is announced once per outage (section 3 of DESIGN-dispatcher.md):
  // a timer starts when a message is queued for it, the notice goes out if the message is still
  // unread when the timer fires, and the next time the dispatcher listens re-arms the notice.
  let outageNotified = false;
  let downTimer: ReturnType<typeof setTimeout> | undefined;
  const markListen = (channel: string, delta: 1 | -1) => {
    const entry = touchChannel(channel);
    entry.listening += delta;
    if (delta === -1) entry.lastListenEndAt = Date.now();
    if (delta === 1 && channel === validDispatcher()?.channel) dispatcherSeen();
  };
  // The dispatcher has just read its queue, so it is alive: the next outage gets its own notice.
  const dispatcherSeen = () => {
    outageNotified = false;
    if (downTimer) clearTimeout(downTimer);
    downTimer = undefined;
  };
  const isChannelListening = (channel: string): boolean => (channelState.get(channel)?.listening ?? 0) > 0;
  const isChannelLive = (channel: string, ttlSeconds: number): boolean => {
    const entry = channelState.get(channel);
    if (!entry) return false;
    return entry.listening > 0 || (entry.lastListenEndAt > 0 && Date.now() - entry.lastListenEndAt < ttlSeconds * 1000);
  };
  const dispatcherStatus = (): DispatcherStatus => {
    const state = readDispatcherConfig();
    if (state.state === "absent") return { mode: "off" };
    if (state.state === "invalid") return { mode: "invalid", error: state.error };
    if (!state.config.enabled) return { mode: "disabled", channel: state.config.channel, listening: isChannelListening(state.config.channel), queued: store.countUnreadForChannel(state.config.channel) };
    return {
      mode: "on",
      channel: state.config.channel,
      listening: isChannelListening(state.config.channel),
      queued: store.countUnreadForChannel(state.config.channel),
    };
  };
  const dispatcherQueued = () => {
    const d = activeDispatcher();
    if (!d || outageNotified || downTimer) return;
    downTimer = setTimeout(() => {
      downTimer = undefined;
      const now = activeDispatcher();
      if (!now || outageNotified || isChannelListening(now.channel)) return;
      const queued = store.countUnreadForChannel(now.channel);
      if (queued === 0) return;
      outageNotified = true;
      api
        .sendMessage(config.chatId, `Dispatcher is not listening. ${queued} message${queued === 1 ? " is" : "s are"} queued and will be handled when it returns.`)
        .catch((error) => log(`dispatcher down notice failed: ${(error as Error).message}`));
    }, d.downNoticeAfterSeconds * 1000);
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

  // The Mini App is optional: nothing below runs unless config.json has a "miniapp" block, and
  // a bad block or a busy port is logged and leaves the rest of the daemon running.
  const miniappSettings = resolveMiniapp(config);
  if (miniappSettings && "error" in miniappSettings) log(`mini app disabled: ${miniappSettings.error}`);
  const miniapp = miniappSettings && !("error" in miniappSettings) ? miniappSettings : undefined;
  const miniappServer = miniapp
    ? createMiniappServer({
        store,
        port,
        onResolved,
        botToken: token,
        allowedUserId: config.userId,
        secret: miniapp.secret,
        maxAgeSeconds: miniapp.maxAgeSeconds,
        log,
      })
    : undefined;
  let miniappUrl: string | undefined;

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
    dispatcher: () => activeDispatcher(),
    isChannelLive,
    isChannelListening,
    dispatcherQueued,
    dispatcherStatus,
    inboxCommandsEnabled: () => {
      const state = readDispatcherConfig();
      return state.state !== "ok" || state.config.inboxCommands;
    },
    logInquiry: (entry) => appendInquiry(entry),
    get miniappUrl() {
      return miniappUrl;
    },
  };

  // Registers the "/" menu Telegram shows in the chat UI. Best-effort: a failure here
  // (network blip, API change) is logged and never stops the daemon from starting.
  if (miniapp && miniappServer) {
    try {
      const bound = await listenLoopback(miniappServer, miniapp.port);
      miniappUrl = miniapp.url;
      log(`mini app listening on 127.0.0.1:${bound}`);
    } catch (error) {
      log(`mini app disabled, could not listen on 127.0.0.1:${miniapp.port}: ${(error as Error).message}`);
    }
  }
  try {
    const dispatcherAtStart = readDispatcherConfig();
    const inboxCommandsAtStart = dispatcherAtStart.state !== "ok" || dispatcherAtStart.config.inboxCommands;
    const menu = inboxCommandsAtStart ? BOT_COMMANDS : BOT_COMMANDS.filter((c) => !BOT_COMMANDS_INBOX.includes(c.command));
    await api.setMyCommands(miniappUrl ? [...menu, OPEN_COMMAND] : menu);
  } catch (error) {
    log(`setMyCommands failed: ${(error as Error).message}`);
  }
  // The button text carries the number of open sets (src/miniapp/menu-count.ts).
  let menuUpdater: ReturnType<typeof createMenuCountUpdater> | undefined;
  if (miniappUrl) {
    const url = miniappUrl;
    menuUpdater = createMenuCountUpdater({
      getCount: () => listView(store).batches.length,
      setText: (text) => api.setChatMenuButton(config.chatId, text, url),
      log,
    });
    menuChanged = () => menuUpdater!.schedule();
    await menuUpdater.syncNow();
  } else {
    try {
      await api.resetChatMenuButton(config.chatId);
    } catch (error) {
      log(`setChatMenuButton failed: ${(error as Error).message}`);
    }
  }

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
      notifyInbox,
      dispatcherSeen,
      addListener,
      isListening,
      markSend,
      markListen,
      channelState,
      isShuttingDown,
      dispatcherStatus,
      menuChanged: () => menuChanged(),
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
      menuUpdater?.stop();
      for (const socket of openSockets) socket.destroy();
      await Promise.race([poller.stop(), sleep(2500)]);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (miniappServer?.listening) {
        miniappServer.closeAllConnections();
        await new Promise<void>((resolve) => miniappServer.close(() => resolve()));
      }
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
  notifyInbox: () => void;
  dispatcherSeen: () => void;
  addListener: (delta: 1 | -1) => void;
  isListening: () => boolean;
  markSend: (channel: string) => void;
  markListen: (channel: string, delta: 1 | -1) => void;
  channelState: Map<string, ChannelEntry>;
  isShuttingDown: () => boolean;
  dispatcherStatus: () => DispatcherStatus;
  // A set was created (resolved sets are reported through onResolved): the menu count may differ.
  menuChanged: () => void;
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

  // Callbacks to run when the client goes away, so a `recv --wait` blocked on the inbox stops
  // waiting for a reader that no longer exists (see the recv case below).
  const closeHooks = new Set<() => void>();
  socket.on("close", () => {
    for (const hook of [...closeHooks]) hook();
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
          const messageId = await sendNotification(deps, request);
          write({ ok: true, ...(messageId !== undefined ? { messageId } : {}) });
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
            dispatcher: deps.dispatcherStatus(),
          });
          return;
        }
        case "recv": {
          const channel = request.channel;
          if (!request.peek && channel === validDispatcher()?.channel) deps.dispatcherSeen();
          const takeUnread = () => deps.store.listUnreadInboxForChannel(channel);
          let unread = takeUnread();

          if (unread.length === 0 && request.wait) {
            // One listener on the dispatcher channel: a second would race the first for messages.
            if (channel === validDispatcher()?.channel && (deps.channelState.get(channel)?.listening ?? 0) > 0) {
              write({ error: `the dispatcher channel "${channel}" already has a listener; only one session may run as the dispatcher` });
              return;
            }
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
                let timer: ReturnType<typeof setTimeout> | undefined;
                const finish = (value: boolean) => {
                  if (settled) return;
                  settled = true;
                  if (timer) clearTimeout(timer);
                  closeHooks.delete(onClose);
                  resolve(value);
                };
                const onClose = () => finish(false);
                closeHooks.add(onClose);
                deps.registerInboxWaiter(() => finish(true));
                if (remainingMs !== undefined) timer = setTimeout(() => finish(false), remainingMs);
              });
              if (!arrived) break;
              unread = takeUnread();
            }
            deps.addListener(-1);
            deps.markListen(channel, -1);
            // The reader died while we waited: leave the message unread for the next listener.
            if (!socket.writable) return;
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
            ...(row.tg_message_id !== null ? { tgMessageId: row.tg_message_id } : {}),
            ...(row.reply_to_message_id !== null
              ? {
                  replyTo: {
                    messageId: row.reply_to_message_id,
                    ...(row.reply_quote ? { quote: row.reply_quote } : {}),
                    ...(row.reply_channel ? { channel: row.reply_channel } : {}),
                  },
                }
              : {}),
            ...(row.inquiry_id ? { inquiry: row.inquiry_id } : {}),
          }));
          // Consume only once the reply has been handed to a live socket. A reply written to a
          // closed socket is lost, and so would the message be if it were already consumed.
          if (!socket.writable) return;
          const consumeIds = request.peek ? [] : unread.map((r) => r.id);
          socket.write(JSON.stringify({ version: 1, status: "received", messages }) + "\n", (error) => {
            if (!error && consumeIds.length) deps.store.consumeInbox(consumeIds);
          });
          return;
        }
        case "inquiry": {
          const known = findInquiry(readInquiries(), request.id);
          if (!known) {
            write({ error: `unknown inquiry ${request.id}` });
            return;
          }
          const at = new Date().toISOString();
          if (request.action === "state") {
            appendInquiry({ op: "state", id: known.id, at, state: request.state ?? "handed_off", ...(request.target ? { target: request.target } : {}), ...(request.ref ? { ref: request.ref } : {}) });
            if ((request.state ?? "handed_off") === "handed_off" && known.tgMessageId) {
              void deps.api.setMessageReaction(deps.config.chatId, known.tgMessageId, REACTION_HANDED_OFF);
            }
            write({ ok: true });
            return;
          }
          if (request.action === "asked") {
            if (request.tgMessageId === undefined) {
              write({ error: "asked needs tgMessageId" });
              return;
            }
            appendInquiry({ op: "asked", id: known.id, at, tgMessageId: request.tgMessageId });
            deps.store.recordMessageInquiry(request.tgMessageId, known.id);
            write({ ok: true });
            return;
          }
          // revive: put the logged text back in the dispatcher's inbox as a new unread row.
          const dispatcher = validDispatcher();
          if (!dispatcher) {
            write({ error: "no valid dispatcher.json; there is nowhere to revive to" });
            return;
          }
          const reviveId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          deps.store.addRevivedInbox({
            id: reviveId,
            text: known.text,
            photo_path: known.photoPath,
            file_path: known.filePath,
            channel: dispatcher.channel,
            tg_message_id: known.tgMessageId,
            inquiry_id: known.id,
          });
          appendInquiry({ op: "revived", id: known.id, at, row: reviveId });
          deps.notifyInbox();
          write({ ok: true, revived: true });
          return;
        }
        case "trial": {
          const dispatcher = validDispatcher();
          if (!dispatcher) {
            write({ error: "no valid dispatcher.json" });
            return;
          }
          const text = request.text.trim();
          if (!text) {
            write({ error: "trial needs text" });
            return;
          }
          const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          deps.store.addInboxMessage({ id, update_id: null, text, photo_path: null, file_path: null, channel: dispatcher.channel });
          appendInquiry({ op: "received", id, at: new Date().toISOString(), state: "received", text, photoPath: null, filePath: null, routedTo: dispatcher.channel, tgMessageId: null });
          deps.notifyInbox();
          write({ ok: true, id });
          return;
        }
        case "quarantine": {
          // Move unrouted unread messages out of the shared inbox into the inquiry log as
          // "legacy". Each line is written before its row is consumed, so a crash in between
          // duplicates a line on re-run at worst, and never loses a message.
          let byChannel: Array<{ channel: string; count: number; oldest: string }> | undefined;
          let rows;
          if (request.staleChannels) {
            // Skip the dispatcher channel (its queue is live work) and any channel with a listener.
            const exclude = [validDispatcher()?.channel, ...[...deps.channelState].filter(([, e]) => e.listening > 0).map(([c]) => c)].filter((c): c is string => Boolean(c));
            const cutoff = new Date(Date.now() - (request.olderSeconds ?? 86400) * 1000).toISOString();
            rows = deps.store.listUnreadOnChannelsBefore(cutoff, exclude);
            const grouped = new Map<string, { count: number; oldest: string }>();
            for (const row of rows) {
              const g = grouped.get(row.channel!) ?? { count: 0, oldest: row.at };
              g.count++;
              if (row.at < g.oldest) g.oldest = row.at;
              grouped.set(row.channel!, g);
            }
            byChannel = [...grouped].map(([channel, g]) => ({ channel, ...g }));
          } else {
            rows = deps.store.listUnroutedUnread();
          }
          if (!request.dryRun) {
            const logged = new Set(readInquiries().map((i) => i.id));
            for (const row of rows) {
              // A row the log already has (received since this build) gets a state line; an older
              // one is logged now, as legacy.
              if (logged.has(row.id)) appendInquiry({ op: "state", id: row.id, at: new Date().toISOString(), state: "legacy" });
              else appendInquiry(entryFromInboxRow(row, "legacy"));
              deps.store.consumeInbox([row.id]);
            }
          }
          write({ quarantined: rows.length, dryRun: request.dryRun, ...(byChannel ? { byChannel } : {}) });
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
  deps.menuChanged();
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
    replyToMessageId?: number;
    inquiryId?: string;
  },
): Promise<number | undefined> {
  const bodyHtml = request.body ? markdownToTelegramHtml(request.body) : undefined;
  const text = renderNotification(request.level, deps.hostname, request.title, bodyHtml);

  let firstMessageId: number | undefined;
  const recordSent = (messageId: number) => {
    if (firstMessageId === undefined) firstMessageId = messageId;
    deps.store.recordMessageChannel(messageId, request.channel);
    if (request.inquiryId) deps.store.recordMessageInquiry(messageId, request.inquiryId);
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
    return firstMessageId;
  }

  await sendTextWithFallback(deps, text, recordSent, request.replyToMessageId);
  return firstMessageId;
}

async function sendTextWithFallback(deps: ConnectionDeps, html: string, recordSent: (messageId: number) => void, replyToMessageId?: number): Promise<void> {
  const chunks = splitMessage(html);
  for (const [index, chunk] of chunks.entries()) {
    const replyTo = index === 0 ? replyToMessageId : undefined;
    try {
      const sent = await deps.api.sendMessage(deps.config.chatId, chunk, { html: true, replyToMessageId: replyTo });
      recordSent(sent.message_id);
    } catch (error) {
      const message = (error as Error).message ?? "";
      if (message.toLowerCase().includes("parse")) {
        // Formatting must never sink a notification: retry as plain text with tags stripped.
        const plain = chunk.replace(/<[^>]+>/g, "");
        const sent = await deps.api.sendMessage(deps.config.chatId, plain, { replyToMessageId: replyTo });
        recordSent(sent.message_id);
      } else {
        throw error;
      }
    }
  }
}

export async function recoverOnStartup(store: Store, port: ReturnType<typeof createTelegramPort>, onResolved: OnResolved, logFn: (l: string) => void): Promise<void> {
  const pending = store.listPendingBatches();
  for (const batch of pending) {
    if (isBatchTimedOut(batch)) {
      await expireBatch(store, port, onResolved, batch.id);
      continue;
    }
    // A live question with no chat message was marked live by a Mini App submit that the crash
    // interrupted: nothing in chat can answer it, so put it back to waiting.
    for (const q of store.listQuestionsForBatch(batch.id)) {
      if ((q.status === "pending" || q.status === "awaiting_text") && q.message_id === null) {
        store.updateQuestion(q.id, { status: "waiting" });
      }
    }
    const questions = store.listQuestionsForBatch(batch.id);
    const live = questions.find((q) => q.status === "pending" || q.status === "awaiting_text");
    // Nothing sent yet (crash between insert and send); a "waiting" head-of-line question; or a
    // question moved to chat ahead of its turn, with the questions before it still waiting.
    const anyWaiting = questions.some((q) => q.status === "waiting");
    if (!live || anyWaiting) {
      try {
        if (questions.every((q) => q.status === "waiting")) await startBatch(store, port, batch.id);
        else await advanceOrFinish(store, port, onResolved, batch.id);
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
