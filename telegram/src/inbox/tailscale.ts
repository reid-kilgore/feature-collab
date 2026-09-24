// Kicks off a Tailscale SSH "check" when maestro's `recent` reports a host unreachable over
// ssh (see the WARNING line printed by `src/inbox/maestro.ts`'s maestroRecent), so Reid can
// approve it from Telegram instead of finding a terminal.
//
// `ssh -o ConnectTimeout=8 <alias> true`, run on a machine whose Tailscale SSH check for that
// peer has lapsed, prints a login.tailscale.com URL on stdout/stderr, then blocks until the
// link is approved in a browser, then connects and exits. This module starts exactly that
// process (argv only, never a shell string — the alias is validated first), watches its early
// output for the URL, and reports back without waiting for the approval itself.

import { spawn, type ChildProcess } from "node:child_process";
import { isTestMode } from "../config.ts";
import { maestroEnv } from "./maestro.ts";

export class TailscaleCheckError extends Error {}

const ALIAS_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const TAILSCALE_URL_PATTERN = /^https:\/\/login\.tailscale\.com\/a\/[A-Za-z0-9]+$/;

// How long we watch the child's output for the check-link line before giving up and reporting
// "no link appeared". The child itself is not killed at this point (see startTailscaleCheck).
// Overridable so tests don't have to wait out the real window.
export const WATCH_MS = Number(process.env.AGENT_TELEGRAM_TAILSCALE_WATCH_MS) || 15_000;
// The child is left running past the watch window, so an approval that comes in after it can
// still complete the ssh connection. It is force-killed if nothing happened by then.
export const HARD_KILL_MS = Number(process.env.AGENT_TELEGRAM_TAILSCALE_HARDKILL_MS) || 10 * 60_000;

function resolveSshBin(): string {
  const override = process.env.AGENT_TELEGRAM_SSH_BIN;
  if (override) return override;
  if (isTestMode()) {
    throw new TailscaleCheckError(
      "refusing to run the real ssh binary under AGENT_TELEGRAM_HOME (test mode): set AGENT_TELEGRAM_SSH_BIN to a stub first",
    );
  }
  return "ssh";
}

export function isValidAlias(alias: string): boolean {
  return ALIAS_PATTERN.test(alias);
}

// Parses the maestro `recent` stderr warning for the host alias it names, e.g. "WARNING:
// could not read the duo inbox (ssh failed) — its items are MISSING below, not zero" -> "duo".
export function parseUnreachableAlias(warning: string): string | undefined {
  const match = /could not read the (\S+) inbox/.exec(warning);
  return match?.[1];
}

export type TailscaleCheckResult = { kind: "link"; url: string } | { kind: "no-link"; detail: string };

export interface TailscaleCheckHandle {
  // Resolves once we know whether a check link appeared, without waiting for the ssh
  // connection itself to finish (that can take minutes, until Reid approves it).
  result: Promise<TailscaleCheckResult>;
  // The spawned process, still running after `result` settles with a link, so callers can
  // observe when it eventually closes (approved, or hard-killed). Undefined when we refused
  // to spawn anything at all (e.g. the test-mode guard on the ssh binary).
  child: ChildProcess | undefined;
}

// Starts `ssh <alias> true` and watches its output for a Tailscale SSH check link. Callers are
// responsible for validating `alias` first (see isValidAlias and the host allowlist in
// handler.ts) — this function does not shell out through anything a message could inject into.
export function startTailscaleCheck(alias: string): TailscaleCheckHandle {
  let bin: string;
  try {
    bin = resolveSshBin();
  } catch (error) {
    return { result: Promise.resolve({ kind: "no-link", detail: (error as TailscaleCheckError).message }), child: undefined };
  }

  const child = spawn(bin, ["-o", "ConnectTimeout=8", alias, "true"], {
    env: maestroEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });

  const hardKill = setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }
  }, HARD_KILL_MS);
  child.once("close", () => clearTimeout(hardKill));

  const result = new Promise<TailscaleCheckResult>((resolve) => {
    let settled = false;
    let combined = "";

    const firstLine = (): string => combined.split("\n").find((line) => line.trim())?.trim() ?? "(no output)";

    const finishNoLink = () => {
      if (settled) return;
      settled = true;
      clearTimeout(watchTimer);
      resolve({ kind: "no-link", detail: firstLine() });
    };

    const finishLink = (url: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchTimer);
      resolve({ kind: "link", url });
    };

    const onData = (chunk: Buffer) => {
      combined += chunk.toString();
      // Tailscale SSH's real output puts the link after a "To authenticate, visit: " prefix
      // on the same line, not alone on one — so look for a whitespace-delimited token on each
      // line that matches the URL pattern exactly, rather than requiring the whole line to.
      for (const line of combined.split("\n")) {
        for (const token of line.trim().split(/\s+/)) {
          if (TAILSCALE_URL_PATTERN.test(token)) {
            finishLink(token);
            return;
          }
        }
      }
    };

    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", (error) => {
      combined += (error as Error).message;
      finishNoLink();
    });
    child.on("close", finishNoLink);

    const watchTimer = setTimeout(finishNoLink, WATCH_MS);
  });

  return { result, child };
}
