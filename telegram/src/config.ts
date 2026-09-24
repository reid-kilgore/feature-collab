// Paths, config file, and secret lookup for agent-telegram.
//
// AGENT_TELEGRAM_HOME redirects every path under one directory. It is meant for tests: it
// also switches token storage away from the macOS Keychain to a plain file, because tests
// must not touch the real Keychain. Real usage never sets this variable.

import { homedir, hostname } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";

export interface Config {
  chatId: string;
  userId: string;
  botUsername: string;
}

const testHome = process.env.AGENT_TELEGRAM_HOME;

export function isTestMode(): boolean {
  return Boolean(testHome);
}

export function configDir(): string {
  return testHome ? path.join(testHome, "config") : path.join(homedir(), ".config", "agent-telegram");
}

export function stateDir(): string {
  return testHome ? path.join(testHome, "state") : path.join(homedir(), ".local", "state", "agent-telegram");
}

export function configFile(): string {
  return path.join(configDir(), "config.json");
}

export function dbFile(): string {
  return path.join(stateDir(), "state.sqlite");
}

export function socketFile(): string {
  return path.join(stateDir(), "daemon.sock");
}

export function logFile(): string {
  return path.join(stateDir(), "daemon.log");
}

export function lockFile(): string {
  return path.join(stateDir(), "daemon.lock");
}

export function inboxDir(): string {
  return path.join(stateDir(), "inbox");
}

export function testTokenFile(): string {
  return path.join(stateDir(), "bot-token");
}

export function ensureDirs(): void {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
  try {
    chmodSync(configDir(), 0o700);
  } catch {
    // best-effort
  }
}

export function readConfig(): Config | undefined {
  try {
    const raw = readFileSync(configFile(), "utf8");
    const parsed = JSON.parse(raw) as Config;
    return parsed;
  } catch {
    return undefined;
  }
}

export function writeConfig(config: Config): void {
  ensureDirs();
  writeFileSync(configFile(), JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}

const KEYCHAIN_SERVICE = "agent-telegram";
const KEYCHAIN_ACCOUNT = "bot-token";

export function getToken(): string | undefined {
  if (process.env.TELEGRAM_BOT_TOKEN) return process.env.TELEGRAM_BOT_TOKEN;
  if (testHome) {
    try {
      return readFileSync(testTokenFile(), "utf8").trim() || undefined;
    } catch {
      return undefined;
    }
  }
  try {
    const out = execFileSync(
      "security",
      ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const token = out.trim();
    return token || undefined;
  } catch {
    return undefined;
  }
}

export function setToken(token: string): void {
  if (testHome) {
    ensureDirs();
    writeFileSync(testTokenFile(), token, { mode: 0o600 });
    return;
  }
  execFileSync("security", [
    "add-generic-password",
    "-U",
    "-s",
    KEYCHAIN_SERVICE,
    "-a",
    KEYCHAIN_ACCOUNT,
    "-w",
    token,
  ]);
}

export function hasToken(): boolean {
  return Boolean(getToken());
}

export function configExists(): boolean {
  return existsSync(configFile());
}

// Fail-closed guard: under AGENT_TELEGRAM_HOME (test mode), there is no legitimate reason to
// fall through to the real Telegram API — that would reach Reid's phone from a test run. A
// test harness must set TELEGRAM_API_BASE to a fake server; a process that forgot to refuses
// outright instead of silently calling the real thing.
export function apiBase(): string {
  const override = process.env.TELEGRAM_API_BASE;
  if (override) return override;
  if (testHome) {
    throw new Error(
      "refusing to call the real Telegram API under AGENT_TELEGRAM_HOME (test mode): set TELEGRAM_API_BASE to a fake server first",
    );
  }
  return "https://api.telegram.org";
}

// Telegram bot tokens look like `123456789:AAExampleTokenCharacters-_HereMore`. Redact
// anything of that shape everywhere we might log or print an error.
const TOKEN_PATTERN = /\d+:[A-Za-z0-9_-]{30,}/g;

export function redact(text: string): string {
  return text.replace(TOKEN_PATTERN, "[REDACTED]");
}

// Two laptops, two bots (see DESIGN.md "Two laptops"): every outbound message is
// prefixed with the short hostname so Reid can tell which machine is talking.
export function shortHostname(): string {
  return process.env.AGENT_TELEGRAM_TEST_HOSTNAME ?? hostname().split(".")[0] ?? hostname();
}
