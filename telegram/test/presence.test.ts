// Presence state: set, read, expiry, clearing, the tg commands, and the UserPromptSubmit hook.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, chmodSync, existsSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPresence, setPresence, describePresence } from "../src/presence.ts";
import { validatePayload } from "../src/contract/payload.ts";
import { setupHarness, sleep, waitForSocketAt, daemonSocketPath } from "./support/harness.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const tgBin = path.resolve(here, "..", "bin", "tg.js");
const hook = path.resolve(here, "..", "hooks", "presence-clear.sh");

function tmpFile(): { dir: string; file: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "presence-"));
  return { dir, file: path.join(dir, "sub", "presence.json") };
}

test("no file reads as present and unset", () => {
  const { dir, file } = tmpFile();
  try {
    assert.deepEqual(readPresence(new Date(), file), { state: "present", reason: "unset", record: null });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("set away records the clock time, note, setter and default expiry; read returns it", () => {
  const { dir, file } = tmpFile();
  try {
    const now = new Date("2026-10-06T10:00:00.000Z");
    const record = setPresence({ state: "away", note: " commuting, use Telegram ", setBy: "composer", now, file });
    assert.equal(record.setAt, "2026-10-06T10:00:00.000Z");
    assert.equal(record.note, "commuting, use Telegram");
    assert.equal(record.setBy, "composer");
    assert.equal(record.expiresAt, "2026-10-06T18:00:00.000Z");
    const reading = readPresence(new Date("2026-10-06T11:00:00.000Z"), file);
    assert.equal(reading.state, "away");
    assert.equal(reading.reason, "recorded");
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), record);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an away record reads as present at and after its expiry, and the file is not rewritten", () => {
  const { dir, file } = tmpFile();
  try {
    setPresence({ state: "away", forSeconds: 3600, now: new Date("2026-10-06T10:00:00.000Z"), file });
    const before = readFileSync(file, "utf8");
    assert.equal(readPresence(new Date("2026-10-06T10:59:59.000Z"), file).state, "away");
    const expired = readPresence(new Date("2026-10-06T11:00:00.000Z"), file);
    assert.equal(expired.state, "present");
    assert.equal(expired.reason, "expired");
    assert.equal(readFileSync(file, "utf8"), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("forSeconds null never expires; present never carries an expiry", () => {
  const { dir, file } = tmpFile();
  try {
    const away = setPresence({ state: "away", forSeconds: null, now: new Date("2026-10-06T10:00:00.000Z"), file });
    assert.equal(away.expiresAt, null);
    assert.equal(readPresence(new Date("2027-01-01T00:00:00.000Z"), file).state, "away");
    const present = setPresence({ state: "present", forSeconds: 60, file });
    assert.equal(present.expiresAt, null);
    assert.equal(readPresence(new Date(), file).state, "present");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a corrupt or wrong-version file reads as present", () => {
  const { dir, file } = tmpFile();
  try {
    setPresence({ state: "away", file });
    writeFileSync(file, "{not json");
    assert.equal(readPresence(new Date(), file).reason, "unset");
    writeFileSync(file, JSON.stringify({ version: 2, state: "away" }));
    assert.equal(readPresence(new Date(), file).state, "present");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("describePresence shows state, note, setter and expiry", () => {
  const { dir, file } = tmpFile();
  try {
    const record = setPresence({ state: "away", note: "at lunch", setBy: "me", forSeconds: 60, file });
    const text = describePresence({ state: "away", reason: "recorded", record });
    assert.match(text, /presence: away/);
    assert.match(text, /note: at lunch/);
    assert.match(text, /by me/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("tg presence away / show / present round trip through the CLI and the test-mode file", async () => {
  const h = await setupHarness();
  try {
    const set = await h.runCli(["presence", "away", "--note", "commuting, use Telegram", "--for", "2h", "--by", "test"]);
    assert.equal(set.code, 0, set.stderr);
    assert.match(set.stdout, /presence: away/);
    const file = path.join(h.home, "state", "presence.json");
    assert.ok(existsSync(file));
    const shown = await h.runCli(["presence", "show", "--json"]);
    const parsed = JSON.parse(shown.stdout);
    assert.equal(parsed.state, "away");
    assert.equal(parsed.record.note, "commuting, use Telegram");
    assert.equal(parsed.record.setBy, "test");
    const bare = await h.runCli(["presence"]);
    assert.match(bare.stdout, /presence: away/);
    const back = await h.runCli(["presence", "present"]);
    assert.equal(back.code, 0, back.stderr);
    assert.equal(JSON.parse((await h.runCli(["presence", "show", "--json"])).stdout).state, "present");
    const bad = await h.runCli(["presence", "away", "--for", "soon"]);
    assert.equal(bad.code, 1);
  } finally { await h.teardown(); }
});

function runHook(file: string, prompt: string, grace = "0"): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const wrapper = path.join(path.dirname(file), "tg-wrapper.sh");
  writeFileSync(wrapper, `#!/bin/sh\nexec node "${tgBin}" "$@"\n`);
  chmodSync(wrapper, 0o755);
  const env = { ...process.env, MAESTRO_PRESENCE_FILE: file, PRESENCE_TG: wrapper, PRESENCE_CLEAR_GRACE_SECONDS: grace };
  const result = spawnSync("sh", [hook], { input: JSON.stringify({ prompt }), env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
}

test("hook: a typed prompt clears away; an injected prompt and a fresh record do not", () => {
  const { dir, file } = tmpFile();
  try {
    setPresence({ state: "away", note: "commuting", file });
    runHook(file, "<teammate-message from main>hi</teammate-message>");
    assert.equal(readPresence(new Date(), file).state, "away");
    runHook(file, "[Cross-session idle notice]");
    assert.equal(readPresence(new Date(), file).state, "away");
    runHook(file, "just set it a moment ago", "3600");
    assert.equal(readPresence(new Date(), file).state, "away");
    runHook(file, "ok I'm back");
    const reading = readPresence(new Date(), file);
    assert.equal(reading.state, "present");
    assert.equal(reading.record?.setBy, "hook:UserPromptSubmit");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("hook: does nothing when no file exists or state is already present", () => {
  const { dir, file } = tmpFile();
  try {
    runHook(file, "hello");
    assert.ok(!existsSync(file));
    setPresence({ state: "present", file });
    const before = readFileSync(file, "utf8");
    runHook(file, "hello");
    assert.equal(readFileSync(file, "utf8"), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// The refusal message tells a session to run `tg ask --file <path>` with the payload it was
// about to give ask-questions. These tests use the fake-Telegram harness, never real Telegram.
// Known difference: ask-questions "quiz" questions are not accepted by tg ask.

const askQuestionsPayload = {
  version: 1,
  title: "Which environment?",
  message: "## Context\n\nPick one.",
  questions: [
    {
      id: "env", prompt: "Which environment?", type: "single", required: true, allowOther: false, placeholder: "unused",
      options: [{ value: "stg", label: "Staging", description: "the shared one" }, { value: "prod", label: "Production" }],
    },
  ],
  documents: [{ id: "d1", title: "Inline", markdown: "# hi" }, { id: "d2", title: "From file", path: "doc.md" }],
};

test("tg ask --file accepts an ask-questions payload file with documents and answers in the same result shape", async () => {
  const h = await setupHarness();
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    const dir = mkdtempSync(path.join(os.tmpdir(), "aq-payload-"));
    writeFileSync(path.join(dir, "doc.md"), "# doc from a relative path\n");
    const file = path.join(dir, "request.json");
    writeFileSync(file, JSON.stringify(askQuestionsPayload));
    const askProc = h.spawnCli(["ask", "--file", file]);
    let stdout = "";
    let stderr = "";
    askProc.stdout!.on("data", (c) => (stdout += c.toString()));
    askProc.stderr!.on("data", (c) => (stderr += c.toString()));
    const shortIdOf = (m: { body: Record<string, unknown> }): string | undefined => {
      const markup = m.body.reply_markup as { inline_keyboard?: Array<Array<{ callback_data?: string }>> } | undefined;
      for (const row of markup?.inline_keyboard ?? []) for (const b of row) {
        const parts = (b.callback_data ?? "").split(":");
        if (parts[0] === "q" && parts[2] === "s") return parts[1];
      }
      return undefined;
    };
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline && !h.fake.sent.some((m) => shortIdOf(m))) await sleep(30);
    const question = h.fake.sent.find((m) => shortIdOf(m));
    assert.ok(question, `no question was sent; stderr: ${stderr}`);
    assert.doesNotMatch(stderr, /Invalid payload/);
    h.fake.pushCallback({ chatId: Number(h.chatId), userId: Number(h.userId), data: `q:${shortIdOf(question!)}:s:0` });
    const code = await new Promise<number | null>((resolve) => askProc.once("close", resolve));
    assert.equal(code, 0, stderr);
    const result = JSON.parse(stdout.trim().split("\n").pop()!);
    assert.equal(result.status, "submitted");
    assert.equal(result.answers.env.value, "stg");
    daemon.kill("SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  } finally { await h.teardown(); }
});

test("tg ask validates every ask-questions question type except quiz", () => {
  const withTypes = {
    ...askQuestionsPayload,
    questions: [
      ...askQuestionsPayload.questions,
      { id: "m", prompt: "p", type: "multiple", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] },
      { id: "t", prompt: "p", type: "text", placeholder: "x" },
    ],
  };
  assert.doesNotThrow(() => validatePayload(withTypes));
  const quiz = { id: "q", prompt: "p", type: "quiz", answer: "a", options: [{ value: "a", label: "A" }] };
  assert.throws(() => validatePayload({ ...askQuestionsPayload, questions: [quiz] }), /invalid/i);
});
