// Thin wrapper around the `maestro` CLI (docs/../bin/maestro, elsewhere in this machine's
// tooling — not part of this package) for the Telegram /ask and /inbox commands. Maestro
// owns the actual inbox storage (one JSONL file per host); this module only shells out to
// it, one argv array per call, never a shell string, so nothing here can be tricked by
// message text into running an arbitrary command.
//
// The binary is resolved from PATH by default. AGENT_TELEGRAM_MAESTRO_BIN overrides that,
// which tests use to point at a stub so they never touch the real maestro inbox on this
// machine.

import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { isTestMode } from "../config.ts";

export class MaestroError extends Error {}

// Fail-closed guard: under AGENT_TELEGRAM_HOME (test mode), there is no legitimate reason to
// fall through to the real `maestro` on PATH — that would write to Reid's actual inbox. A
// test harness must set AGENT_TELEGRAM_MAESTRO_BIN to a stub; a process that forgot to
// refuses outright instead of silently calling the real thing.
function resolveBin(): string {
  const override = process.env.AGENT_TELEGRAM_MAESTRO_BIN;
  if (override) return override;
  if (isTestMode()) {
    throw new MaestroError(
      "refusing to run the real maestro binary under AGENT_TELEGRAM_HOME (test mode): set AGENT_TELEGRAM_MAESTRO_BIN to a stub first",
    );
  }
  return "maestro";
}

// The daemon runs under launchd, whose PATH is only /usr/bin:/bin:/usr/sbin:/sbin (read
// first-hand on REDD-mason). `maestro` lives in ~/bin, and its `#!/usr/bin/env python3` needs
// Homebrew's python, so both directories go in front of whatever PATH the daemon was given.
// The child resolves `maestro` and `python3` against this PATH.
export function maestroEnv(base: NodeJS.ProcessEnv = process.env, home: string = homedir()): NodeJS.ProcessEnv {
  const extra = [join(home, "bin"), "/opt/homebrew/bin", "/usr/local/bin"];
  const rest = (base.PATH ?? "").split(":").filter((dir) => dir && !extra.includes(dir));
  return { ...base, PATH: [...extra, ...rest].join(":") };
}

function run(argv: string[], opts: { input?: string } = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let bin: string;
    try {
      bin = resolveBin();
    } catch (error) {
      reject(error as MaestroError);
      return;
    }
    const child = execFile(bin, argv, { maxBuffer: 10 * 1024 * 1024, env: maestroEnv() }, (error, stdout, stderr) => {
      if (error) {
        const message = stderr.trim() || (error as Error).message;
        reject(new MaestroError(message));
        return;
      }
      resolve({ stdout, stderr });
    });
    if (opts.input !== undefined) child.stdin?.write(opts.input);
    child.stdin?.end();
  });
}

// `maestro add -` reads the item's text from stdin (kind: ask) and prints "<id>  <label>"
// to stdout on success. We only need the id, which is the first whitespace-delimited token.
export async function maestroAdd(text: string): Promise<string> {
  const { stdout } = await run(["add", "-"], { input: text });
  const id = stdout.trim().split(/\s+/, 1)[0];
  if (!id) throw new MaestroError(`could not read an id from maestro add: ${JSON.stringify(stdout)}`);
  return id;
}

export interface MaestroTrailEntry {
  op: string;
  by: string;
  at: string;
  text: string;
}

export interface MaestroItem {
  id: string;
  host: string;
  kind: string;
  state: string;
  by: string;
  at: string;
  touched: string;
  text: string;
  ref?: string | null;
  trail: MaestroTrailEntry[];
}

export interface MaestroRecentResult {
  items: MaestroItem[];
  warnings: string[];
}

// `maestro recent --json --by reid --hours <hours> --hosts <hosts>`. Per DESIGN.md-equivalent
// brief: an unreachable host prints a WARNING on stderr and its items are simply missing from
// the JSON, never folded in as empty; we surface those warnings to the caller rather than
// swallowing them, so a partial list can say which host is missing.
export async function maestroRecent(hours: number, hosts: string[]): Promise<MaestroRecentResult> {
  const { stdout, stderr } = await run([
    "recent",
    "--json",
    "--by",
    "reid",
    "--hours",
    String(hours),
    "--hosts",
    hosts.join(","),
  ]);
  const warnings = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("WARNING:"));
  let items: MaestroItem[];
  try {
    const parsed = JSON.parse(stdout || "[]") as unknown;
    items = Array.isArray(parsed) ? (parsed as MaestroItem[]) : [];
  } catch {
    throw new MaestroError(`could not parse maestro recent output as JSON: ${stdout.slice(0, 200)}`);
  }
  return { items, warnings };
}
