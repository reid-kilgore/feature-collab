// Handing a message to a target (DESIGN-dispatcher.md): the shared part of `tg dispatch <target>` and the
// daemon's unconsumed-message alarm. A target is a command that reads the message on stdin and prints a
// reference on its first line.

import { spawn } from "node:child_process";
import type { Target } from "./config.ts";

// What of an inquiry or an inbox row reaches a target.
export interface MessageParts {
  text: string | null;
  replyToQuote: string | null;
  replyToChannel: string | null;
  photoPath: string | null;
  filePath: string | null;
}

export interface RunResult {
  ok: boolean;
  stdout: string;
  error?: string;
}

export function substitute(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
    if (!(key in values)) throw new Error(`missing value for {{${key}}}`);
    return values[key]!;
  });
}

export function messageForTarget(inquiry: MessageParts): string {
  const parts = [inquiry.text ?? ""];
  if (inquiry.replyToQuote) parts.push(`(replying to: "${inquiry.replyToQuote}")${inquiry.replyToChannel ? ` · reply to a notice from channel ${inquiry.replyToChannel}` : ""}`);
  if (inquiry.photoPath) parts.push(`Attachment (photo): ${inquiry.photoPath}`);
  if (inquiry.filePath) parts.push(`Attachment (file): ${inquiry.filePath}`);
  return parts.filter(Boolean).join("\n\n");
}

export function runCommand(argv: string[], stdin: string, timeoutMs = 60_000): Promise<RunResult> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(argv[0]!, argv.slice(1), { stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      resolve({ ok: false, stdout: "", error: (error as Error).message });
      return;
    }
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    child.stdin.on("error", () => {});
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, stdout, error: error.message });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve({ ok: true, stdout });
      else resolve({ ok: false, stdout, error: stderr.trim().split("\n")[0] || `exited with ${signal ?? code}` });
    });
    child.stdin.end(stdin);
  });
}

export interface HandOffResult {
  ok: boolean;
  ref: string;
  error?: string;
}

// The daemon's hand-off: only a target with an argv can be run without a person (a claude-session target
// needs a working directory the dispatcher chooses). The message goes to the target's stdin, as with
// `tg dispatch`.
export async function handOffToTarget(target: Target, message: MessageParts): Promise<HandOffResult> {
  if (!target.argv) return { ok: false, ref: "", error: `target ${target.name} is not a command target, so the daemon cannot run it` };
  let argv: string[];
  try {
    argv = target.argv.map((a) => substitute(a, { name: target.name }));
  } catch (error) {
    return { ok: false, ref: "", error: `target ${target.name} needs a parameter the daemon does not have: ${(error as Error).message}` };
  }
  const result = await runCommand(argv, messageForTarget(message));
  if (!result.ok) return { ok: false, ref: "", error: result.error ?? "unknown error" };
  return { ok: true, ref: result.stdout.trim().split(/\s+/, 1)[0] ?? "" };
}
