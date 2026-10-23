// Unix socket client for the daemon. Auto-starts the daemon (detached) if the socket is
// dead, and retries connecting for a few seconds so the tool works without launchd.

import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { socketFile } from "../config.ts";
import type { DaemonRequest, DaemonResponse, AskResolvedResponse, ErrorResponse } from "../daemon/protocol.ts";
import type { AskResult } from "../contract/payload.ts";

const CONNECT_RETRY_MS = 200;
const CONNECT_TIMEOUT_MS = Number(process.env.AGENT_TELEGRAM_CONNECT_MS) || 5000;

function tgBinPath(): string {
  // src/cli/client.ts -> ../../bin/tg.js
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, "..", "..", "bin", "tg.js");
}

async function tryConnectOnce(): Promise<net.Socket | undefined> {
  return new Promise((resolve) => {
    const socket = net.connect(socketFile());
    const onError = () => {
      socket.destroy();
      resolve(undefined);
    };
    socket.once("error", onError);
    socket.once("connect", () => {
      socket.off("error", onError);
      resolve(socket);
    });
  });
}

function spawnDaemon(): void {
  const child = spawn(process.execPath, [tgBinPath(), "daemon"], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
}

export async function connectToDaemon(): Promise<net.Socket> {
  const first = await tryConnectOnce();
  if (first) return first;

  // A caller that supervises its own reconnecting (the dispatcher's wait) or a test can turn the
  // automatic start off; the polling below still gives a daemon that is mid-start a few seconds.
  if (!process.env.AGENT_TELEGRAM_NO_AUTOSTART) spawnDaemon();

  const deadline = Date.now() + CONNECT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(CONNECT_RETRY_MS);
    const socket = await tryConnectOnce();
    if (socket) return socket;
  }
  throw new Error("Could not connect to the agent-telegram daemon (tried to start it automatically).");
}

// Sends one request and resolves with the first response line. Leaves the socket open and
// keeps reading; used for `ask`, which gets an {id} line immediately and a {result} line
// later, and by wrappers below.
export function sendRequest(socket: net.Socket, request: DaemonRequest): void {
  socket.write(JSON.stringify(request) + "\n");
}

export function readResponses(socket: net.Socket, onLine: (response: DaemonResponse) => void, onEnd: () => void): void {
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (!line.trim()) continue;
      onLine(JSON.parse(line) as DaemonResponse);
    }
  });
  socket.on("close", onEnd);
}

export async function oneShot(request: DaemonRequest): Promise<DaemonResponse> {
  const socket = await connectToDaemon();
  return new Promise((resolve, reject) => {
    readResponses(
      socket,
      (response) => {
        socket.end();
        resolve(response);
      },
      () => reject(new Error("daemon closed the connection without responding")),
    );
    sendRequest(socket, request);
  });
}

// How long a waiting command keeps trying to reach a daemon that went away (a launchd restart, a crash)
// before it gives up. Env overrides are for tests.
export const RECONNECT_LIMIT_MS = Number(process.env.AGENT_TELEGRAM_RECONNECT_MS) || 5 * 60_000;
export const RECONNECT_BASE_MS = Number(process.env.AGENT_TELEGRAM_RECONNECT_BASE_MS) || 1000;
export const RECONNECT_MAX_MS = 15_000;

export class LostDaemonError extends Error {}

// Waits for a stored question's result, re-attaching with `wait` whenever the daemon connection drops
// (before the first attempt as well). A question lives in the daemon's database, so a restarted daemon still
// has it and the answer still arrives. An error answer from a live daemon (an unknown id) is thrown at once;
// a daemon that stays away for the whole limit throws LostDaemonError.
export async function waitForResult(batchId: string): Promise<AskResult> {
  let lostSince: number | undefined;
  let attempt = 0;
  for (;;) {
    try {
      const socket = await connectToDaemon();
      const response = await new Promise<DaemonResponse | undefined>((resolve) => {
        let got: DaemonResponse | undefined;
        readResponses(
          socket,
          (r) => {
            got = r;
            socket.end();
            resolve(r);
          },
          () => resolve(got),
        );
        sendRequest(socket, { op: "wait", id: batchId });
      });
      if (response && "result" in response) return (response as AskResolvedResponse).result;
      if (response && "error" in response) throw new Error((response as ErrorResponse).error);
      // the connection ended with no answer: the daemon went away; fall through to retry
    } catch (error) {
      if (!/Could not connect to the agent-telegram daemon/.test((error as Error).message)) throw error;
    }
    const now = Date.now();
    lostSince ??= now;
    if (now - lostSince >= RECONNECT_LIMIT_MS) {
      throw new LostDaemonError(`the daemon went away; the question is still open; run \`tg wait ${batchId}\` once it is back (\`tg doctor\` says what is wrong)`);
    }
    await sleep(Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS));
    attempt++;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
