// Spawns the real daemon and CLI as subprocesses against a temp AGENT_TELEGRAM_HOME and a
// FakeTelegram server, for true end-to-end integration tests.

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, chmodSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FakeTelegram } from "./fake-telegram.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const tgBin = path.join(repoRoot, "bin", "tg.js");

// Isolation guard, independent of the maestro-binary and Telegram-API guards below: a
// directory a test hands to something that might write real data must resolve (after
// symlinks — macOS's /tmp is a symlink to /private/tmp) inside the OS temp directory. Used
// both for this harness's own home directory and for MAESTRO_INBOX_DIR, so that even if the
// real `maestro` binary somehow ran during a test, it would write to a throwaway location,
// never ~/.maestro. Exported so a unit test can demonstrate it actually trips.
export function assertInsideTempDir(dirPath: string): void {
  const real = realpathSync(dirPath);
  const tmpRoot = realpathSync(os.tmpdir());
  if (real !== tmpRoot && !real.startsWith(tmpRoot + path.sep)) {
    throw new Error(`refusing to use ${dirPath} (resolves to ${real}): it is not inside the OS temp directory (${tmpRoot})`);
  }
}

// The MAESTRO_INBOX_DIR invariant this harness relies on, as its own checkable function: unset
// is refused outright (a real maestro binary would default to ~/.maestro/inbox.jsonl), and set
// is still required to resolve inside the OS temp directory.
export function assertMaestroInboxDirEnv(dir: string | undefined): void {
  if (!dir) {
    throw new Error("MAESTRO_INBOX_DIR is not set: a real maestro binary would default to ~/.maestro/inbox.jsonl");
  }
  assertInsideTempDir(dir);
}

// A stub `maestro` binary, so no test ever reaches the real one on this machine (agent-telegram
// now shells out to `maestro add`/`maestro recent` for /ask and /inbox). It is file-driven, all
// under the harness's own temp home, so tests control it by writing fixtures instead of poking
// at argv-parsing logic of their own:
//   <home>/maestro-recent-items.json    - array of items `recent` prints (default: [])
//   <home>/maestro-recent-warnings.txt  - one "WARNING: ..." line per line, to stderr
//   <home>/maestro-fail-recent          - if present, `recent` exits 1 with this file's text
//   <home>/maestro-fail-add             - if present, `add` exits 1 with this file's text
//   <home>/maestro-added.jsonl          - every successful `add`'s text, appended, for assertions
// A successful `add` mints an id by counting lines already in maestro-added.jsonl.
const MAESTRO_STUB_SOURCE = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const home = __dirname;
const [, , cmd, ...rest] = process.argv;
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
if (cmd === "add") {
  const failFile = path.join(home, "maestro-fail-add");
  if (fs.existsSync(failFile)) {
    process.stderr.write(fs.readFileSync(failFile, "utf8") || "stub add failure\\n");
    process.exit(1);
  }
  let text = rest[0] === "-" ? fs.readFileSync(0, "utf8") : rest.join(" ");
  const addedFile = path.join(home, "maestro-added.jsonl");
  const priorLines = fs.existsSync(addedFile) ? fs.readFileSync(addedFile, "utf8").split("\\n").filter(Boolean) : [];
  const id = "t" + (priorLines.length + 1);
  fs.appendFileSync(addedFile, JSON.stringify({ id, text }) + "\\n");
  process.stdout.write(id + "  " + text.split("\\n")[0].slice(0, 40) + "\\n");
  process.exit(0);
}
if (cmd === "recent") {
  const failFile = path.join(home, "maestro-fail-recent");
  if (fs.existsSync(failFile)) {
    process.stderr.write(fs.readFileSync(failFile, "utf8") || "stub recent failure\\n");
    process.exit(1);
  }
  const items = readJson(path.join(home, "maestro-recent-items.json"), []);
  const warningsFile = path.join(home, "maestro-recent-warnings.txt");
  if (fs.existsSync(warningsFile)) process.stderr.write(fs.readFileSync(warningsFile, "utf8"));
  process.stdout.write(JSON.stringify(items) + "\\n");
  process.exit(0);
}
process.stderr.write("maestro-stub: unknown command " + cmd + "\\n");
process.exit(1);
`;

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
  // Refuse to proceed at all if this harness's own home somehow isn't a throwaway temp
  // directory — every other guard in this file assumes it is.
  assertInsideTempDir(home);

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

  const maestroStubPath = path.join(home, "maestro-stub.cjs");
  writeFileSync(maestroStubPath, MAESTRO_STUB_SOURCE, { mode: 0o755 });
  chmodSync(maestroStubPath, 0o755);

  // Second, independent layer under the AGENT_TELEGRAM_MAESTRO_BIN guard in
  // src/inbox/maestro.ts: if the real `maestro` binary somehow ran anyway (a symlink shadowing
  // the stub, a future code path that calls it directly), it still could not reach the real
  // inbox, because this is where it would write. Refuses loudly if that path is ever not a
  // temp directory.
  const maestroInboxDir = path.join(home, "maestro-inbox-dir");
  mkdirSync(maestroInboxDir, { recursive: true });
  assertInsideTempDir(maestroInboxDir);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AGENT_TELEGRAM_HOME: home,
    TELEGRAM_API_BASE: fake.baseUrl,
    TELEGRAM_BOT_TOKEN: "123456789:FAKE-TOKEN-FOR-TESTS-0123456789",
    AGENT_TELEGRAM_TEST_HOSTNAME: opts.hostname ?? "test-host",
    // Never the real maestro on PATH: see MAESTRO_STUB_SOURCE above for how tests drive it.
    AGENT_TELEGRAM_MAESTRO_BIN: maestroStubPath,
    // Belt-and-suspenders: see the comment on maestroInboxDir above.
    MAESTRO_INBOX_DIR: maestroInboxDir,
  };

  // Live enforcement of the invariant, on the exact value about to be handed to every spawned
  // child: refuses the whole harness setup rather than let a test proceed with an unsafe or
  // missing MAESTRO_INBOX_DIR.
  assertMaestroInboxDirEnv(env.MAESTRO_INBOX_DIR);

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
