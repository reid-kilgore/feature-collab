// Unix socket client for the daemon. Auto-starts the daemon (detached) if the socket is
// dead, and retries connecting for a few seconds so the tool works without launchd.

import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { socketFile } from "../config.ts";
import type { DaemonRequest, DaemonResponse } from "../daemon/protocol.ts";

const CONNECT_RETRY_MS = 200;
const CONNECT_TIMEOUT_MS = 5000;

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

  spawnDaemon();

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
