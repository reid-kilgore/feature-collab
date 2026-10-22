// Paths, config file, and secret lookup for agent-telegram.
//
// AGENT_TELEGRAM_HOME redirects every path under one directory. It is meant for tests: it
// also switches token storage away from the macOS Keychain to a plain file, because tests
// must not touch the real Keychain. Real usage never sets this variable.

import { homedir, hostname } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";

// Mini App settings, all optional: without them the daemon does not start the HTTP server at all.
// Set by hand in config.json (see DESIGN.md "Mini App"). `tg setup` keeps them when it rewrites
// the file.
export interface MiniappConfig {
  // Local port the server listens on (127.0.0.1 only). Tailscale Funnel proxies to it.
  port: number;
  // Random string used as the first path segment of every URL, at least 16 characters of
  // letters, digits, "_" or "-". Not a credential (initData is), only a guard against scanners.
  secret: string;
  // Public HTTPS origin Funnel serves, for example "https://redd.example.ts.net". No path.
  publicUrl: string;
  // How old initData may be, in seconds. Default 3600.
  maxAgeSeconds?: number;
}

export interface Config {
  chatId: string;
  userId: string;
  botUsername: string;
  miniapp?: MiniappConfig;
}

export interface ResolvedMiniapp {
  port: number;
  secret: string;
  maxAgeSeconds: number;
  // The full URL the bot opens: origin + "/" + secret + "/".
  url: string;
}

export const DEFAULT_MINIAPP_MAX_AGE_SECONDS = 3600;

// Returns the Mini App settings to use, nothing when the feature is not configured, or an
// error string when it is configured wrongly (the daemon logs it and runs without the Mini App).
export function resolveMiniapp(config: Config): ResolvedMiniapp | { error: string } | undefined {
  const m = config.miniapp;
  if (!m) return undefined;
  if (!Number.isInteger(m.port) || m.port < 1 || m.port > 65535) return { error: "miniapp.port must be an integer from 1 to 65535" };
  if (typeof m.secret !== "string" || !/^[A-Za-z0-9_-]{16,}$/.test(m.secret)) {
    return { error: "miniapp.secret must be at least 16 characters of letters, digits, _ or -" };
  }
  let origin: URL;
  try {
    origin = new URL(m.publicUrl);
  } catch {
    return { error: "miniapp.publicUrl must be a URL like https://host.example.ts.net" };
  }
  if (origin.protocol !== "https:") return { error: "miniapp.publicUrl must be https (Telegram only opens Mini Apps over HTTPS)" };
  const maxAge = m.maxAgeSeconds ?? DEFAULT_MINIAPP_MAX_AGE_SECONDS;
  if (!Number.isInteger(maxAge) || maxAge < 60 || maxAge > 86400) return { error: "miniapp.maxAgeSeconds must be an integer from 60 to 86400" };
  return { port: m.port, secret: m.secret, maxAgeSeconds: maxAge, url: `${origin.origin}/${m.secret}/` };
}

const testHome = process.env.AGENT_TELEGRAM_HOME;

export function isTestMode(): boolean {
  return Boolean(testHome);
}

export function configDir(): string {
  return testHome ? path.join(testHome, "config") : path.join(homedir(), ".config", "agent-telegram");
}

// The tmux executable. Tests must never reach the real tmux, so under AGENT_TELEGRAM_HOME the override
// is required (the same fail-closed guard as the maestro, ssh and Telegram API bases).
export function tmuxBin(): string {
  const override = process.env.AGENT_TELEGRAM_TMUX_BIN;
  if (override) return override;
  if (testHome) throw new Error("refusing to run the real tmux under AGENT_TELEGRAM_HOME (test mode): set AGENT_TELEGRAM_TMUX_BIN to a stub first");
  return "tmux";
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

// Append-only record of every inbound message (see DESIGN-dispatcher.md, "Inquiry log").
export function inquiriesFile(): string {
  return path.join(stateDir(), "inquiries.jsonl");
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
