// Demonstrates that the test-isolation guards actually trip, not just that they exist.
// Three independent layers protect Reid's real maestro inbox and his real phone from a test
// run that forgot to wire something up:
//   1. src/inbox/maestro.ts refuses to run the real `maestro` binary when AGENT_TELEGRAM_HOME
//      (test mode) is set and AGENT_TELEGRAM_MAESTRO_BIN is not.
//   2. src/config.ts's apiBase() refuses to call the real Telegram API under the same
//      condition, when TELEGRAM_API_BASE is not set.
//   3. test/support/harness.ts refuses to hand out a MAESTRO_INBOX_DIR that is missing or
//      outside the OS temp directory, so even a real maestro binary that somehow ran would
//      only ever write to a throwaway file.
//   4. src/inbox/tailscale.ts refuses to run the real `ssh` binary under the same condition,
//      when AGENT_TELEGRAM_SSH_BIN is not set.
// (1) and (2) are demonstrated in a freshly spawned child process, not by mutating
// process.env in this shared test-runner process: config.ts reads AGENT_TELEGRAM_HOME once
// at module load, so only a fresh process sees an env change — which also matches how the
// real daemon (itself a fresh spawn every time) sees it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertInsideTempDir, assertMaestroInboxDirEnv } from "./support/harness.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const checkScript = path.join(here, "support", "isolation-check.ts");

function runCheck(check: string, env: NodeJS.ProcessEnv): Promise<{ stdout: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [checkScript, check], { env });
    let stdout = "";
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.on("close", (code) => resolve({ stdout: stdout.trim(), code }));
  });
}

test("guard 1: maestroAdd refuses the real maestro binary in test mode with no stub override", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "isolation-guard1-"));
  try {
    // Deliberately the failure case: AGENT_TELEGRAM_HOME (test mode) is set, but
    // AGENT_TELEGRAM_MAESTRO_BIN is not — this is exactly the "missed stub" scenario.
    const env: NodeJS.ProcessEnv = { ...process.env, AGENT_TELEGRAM_HOME: home };
    delete env.AGENT_TELEGRAM_MAESTRO_BIN;
    const { stdout } = await runCheck("maestro-add", env);
    assert.match(stdout, /^THREW /);
    assert.match(stdout, /refusing to run the real maestro binary/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("guard 1 control: maestroAdd works normally once AGENT_TELEGRAM_MAESTRO_BIN points at a stub", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "isolation-guard1-control-"));
  try {
    const stubPath = path.join(home, "maestro-stub.cjs");
    writeFileSync(
      stubPath,
      `#!/usr/bin/env node\nconst fs = require("node:fs");\nfs.readFileSync(0, "utf8");\nprocess.stdout.write("ok1  stub item\\n");\n`,
      { mode: 0o755 },
    );
    chmodSync(stubPath, 0o755);
    const env = { ...process.env, AGENT_TELEGRAM_HOME: home, AGENT_TELEGRAM_MAESTRO_BIN: stubPath };
    const { stdout } = await runCheck("maestro-add", env);
    assert.equal(stdout, "OK id=ok1");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("guard 2: apiBase() refuses the real Telegram API in test mode with no TELEGRAM_API_BASE override", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "isolation-guard2-"));
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, AGENT_TELEGRAM_HOME: home };
    delete env.TELEGRAM_API_BASE;
    const { stdout } = await runCheck("api-base", env);
    assert.match(stdout, /^THREW /);
    assert.match(stdout, /refusing to call the real Telegram API/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("guard 2 control: apiBase() returns the fake server once TELEGRAM_API_BASE is set", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "isolation-guard2-control-"));
  try {
    const env = { ...process.env, AGENT_TELEGRAM_HOME: home, TELEGRAM_API_BASE: "http://127.0.0.1:9" };
    const { stdout } = await runCheck("api-base", env);
    assert.equal(stdout, "OK value=http://127.0.0.1:9");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("guard 4: startTailscaleCheck refuses the real ssh binary in test mode with no stub override", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "isolation-guard4-"));
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, AGENT_TELEGRAM_HOME: home };
    delete env.AGENT_TELEGRAM_SSH_BIN;
    const { stdout } = await runCheck("ssh-check", env);
    assert.match(stdout, /^OK /);
    const outcome = JSON.parse(stdout.slice("OK ".length));
    assert.equal(outcome.kind, "no-link");
    assert.match(outcome.detail, /refusing to run the real ssh binary/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("guard 4 control: startTailscaleCheck runs the stub once AGENT_TELEGRAM_SSH_BIN points at one", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "isolation-guard4-control-"));
  try {
    const stubPath = path.join(home, "ssh-stub.cjs");
    writeFileSync(
      stubPath,
      `#!/usr/bin/env node\nprocess.stdout.write("# To authenticate, visit: https://login.tailscale.com/a/zzz999\\n");\n`,
      { mode: 0o755 },
    );
    chmodSync(stubPath, 0o755);
    const env = { ...process.env, AGENT_TELEGRAM_HOME: home, AGENT_TELEGRAM_SSH_BIN: stubPath, AGENT_TELEGRAM_TAILSCALE_WATCH_MS: "500" };
    const { stdout } = await runCheck("ssh-check", env);
    const outcome = JSON.parse(stdout.slice("OK ".length));
    assert.deepEqual(outcome, { kind: "link", url: "https://login.tailscale.com/a/zzz999" });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("guard 3: the harness refuses an unset MAESTRO_INBOX_DIR", () => {
  assert.throws(() => assertMaestroInboxDirEnv(undefined), /MAESTRO_INBOX_DIR is not set/);
});

test("guard 3: the harness refuses a MAESTRO_INBOX_DIR outside the OS temp directory", () => {
  // Reid's real home directory is never inside the OS temp directory.
  assert.throws(() => assertMaestroInboxDirEnv(os.homedir()), /not inside the OS temp directory/);
});

test("guard 3 control: the harness accepts a MAESTRO_INBOX_DIR that is a real temp directory", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "isolation-guard3-control-"));
  try {
    assert.doesNotThrow(() => assertMaestroInboxDirEnv(dir));
    assert.doesNotThrow(() => assertInsideTempDir(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
