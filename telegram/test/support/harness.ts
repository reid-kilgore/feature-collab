// Spawns the real daemon and CLI as subprocesses against a temp AGENT_TELEGRAM_HOME and a
// FakeTelegram server, for true end-to-end integration tests.

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FakeTelegram } from "./fake-telegram.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const tgBin = path.join(repoRoot, "bin", "tg.js");

export interface Harness {
  home: string;
  fake: FakeTelegram;
  chatId: string;
  userId: string;
  env: NodeJS.ProcessEnv;
  runCli(args: string[], opts?: { input?: string }): Promise<{ stdout: string; stderr: string; code: number | null }>;
  spawnCli(args: string[]): ChildProcess;
  stopDaemon(): Promise<void>;
  teardown(): Promise<void>;
}

export async function setupHarness(opts: { hostname?: string } = {}): Promise<Harness> {
  const home = mkdtempSync(path.join(os.tmpdir(), "agent-telegram-home-"));
  const fake = new FakeTelegram();
  await fake.start();

  const chatId = "1001";
  const userId = "2002";

  const configDir = path.join(home, "config");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    path.join(configDir, "config.json"),
    JSON.stringify({ chatId, userId, botUsername: "fakebot" }, null, 2),
  );

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AGENT_TELEGRAM_HOME: home,
    TELEGRAM_API_BASE: fake.baseUrl,
    TELEGRAM_BOT_TOKEN: "123456789:FAKE-TOKEN-FOR-TESTS-0123456789",
    AGENT_TELEGRAM_TEST_HOSTNAME: opts.hostname ?? "test-host",
  };

  let daemonProc: ChildProcess | undefined;

  const runCli = (args: string[], runOpts: { input?: string } = {}): Promise<{ stdout: string; stderr: string; code: number | null }> => {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [tgBin, ...args], { env });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (c) => (stdout += c.toString()));
      child.stderr.on("data", (c) => (stderr += c.toString()));
      if (runOpts.input !== undefined) {
        child.stdin.write(runOpts.input);
      }
      child.stdin.end();
      child.on("close", (code) => resolve({ stdout, stderr, code }));
    });
  };

  const spawnCli = (args: string[]): ChildProcess => {
    return spawn(process.execPath, [tgBin, ...args], { env });
  };

  const socketPath = path.join(home, "state", "daemon.sock");
  const waitForSocket = async (timeoutMs = 5000): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (existsSync(socketPath)) return;
      await sleep(50);
    }
    throw new Error("daemon socket did not appear in time");
  };

  return {
    home,
    fake,
    chatId,
    userId,
    env,
    runCli,
    spawnCli,
    async stopDaemon() {
      if (daemonProc) {
        daemonProc.kill("SIGTERM");
        await new Promise((resolve) => daemonProc!.once("close", resolve));
        daemonProc = undefined;
      }
    },
    async teardown() {
      if (daemonProc) daemonProc.kill("SIGKILL");
      await fake.stop();
      rmSync(home, { recursive: true, force: true });
    },
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForSocketAt(socketPath: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(socketPath)) return;
    await sleep(50);
  }
  throw new Error("daemon socket did not appear in time: " + socketPath);
}

export function daemonSocketPath(home: string): string {
  return path.join(home, "state", "daemon.sock");
}
