// tg send --photo / --document: checks in the CLI, order of messages, captions, and the unit checks of paths.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, truncateSync, chmodSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveAttachmentPath } from "../src/cli/attachments.ts";
import { setupHarness, sleep, waitForSocketAt, daemonSocketPath } from "./support/harness.ts";
import type { Harness } from "./support/harness.ts";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

async function until(f: () => boolean, ms = 20000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (f()) return;
    await sleep(30);
  }
  throw new Error("condition not met in time");
}

// Only the messages a person sees: the daemon also makes setup calls when it starts.
const shown = (h: Harness) => h.fake.sent.filter((m) => /^send/.test(m.method));

async function withDaemon(fn: (h: Harness, dir: string) => Promise<void>): Promise<void> {
  const h = await setupHarness();
  const dir = mkdtempSync(path.join(os.tmpdir(), "tg-send-att-"));
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    await fn(h, dir);
    daemon.kill("SIGKILL");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await h.teardown();
  }
}

test("resolveAttachmentPath makes the path absolute and refuses missing, empty, wrong-type and oversize files", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tg-att-unit-"));
  try {
    writeFileSync(path.join(dir, "a.png"), PNG);
    writeFileSync(path.join(dir, "notes.txt"), "hi");
    writeFileSync(path.join(dir, "empty.png"), "");
    writeFileSync(path.join(dir, "big.png"), "x");
    truncateSync(path.join(dir, "big.png"), 10 * 1024 * 1024 + 1);
    writeFileSync(path.join(dir, "huge.bin"), "x");
    truncateSync(path.join(dir, "huge.bin"), 50 * 1024 * 1024 + 1);
    assert.equal(resolveAttachmentPath("photo", "a.png", dir), path.join(dir, "a.png"));
    assert.equal(resolveAttachmentPath("document", "notes.txt", dir), path.join(dir, "notes.txt"));
    assert.equal(resolveAttachmentPath("document", "big.png", dir), path.join(dir, "big.png"));
    assert.throws(() => resolveAttachmentPath("photo", "nope.png", dir), /does not exist/);
    assert.throws(() => resolveAttachmentPath("photo", ".", dir), /is not a file/);
    assert.throws(() => resolveAttachmentPath("photo", "empty.png", dir), /is empty/);
    assert.throws(() => resolveAttachmentPath("photo", "notes.txt", dir), /not a png.*--document/);
    assert.throws(() => resolveAttachmentPath("photo", "big.png", dir), /10 MB.*--document/);
    assert.throws(() => resolveAttachmentPath("document", "huge.bin", dir), /50 MB/);
    assert.throws(() => resolveAttachmentPath("photo", "", dir), /needs a file path/);
    if (process.getuid?.() !== 0) {
      chmodSync(path.join(dir, "notes.txt"), 0);
      assert.throws(() => resolveAttachmentPath("document", "notes.txt", dir), /not readable/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tg send sends the text, then each --photo and --document in order, with the caption that follows each", async () => {
  await withDaemon(async (h, dir) => {
    writeFileSync(path.join(dir, "a.png"), PNG);
    writeFileSync(path.join(dir, "b.png"), PNG);
    writeFileSync(path.join(dir, "r.pdf"), "%PDF-1.4");
    const f = (n: string) => path.join(dir, n);
    const r = await h.runCli(["send", "Morning report", "--photo", f("a.png"), "--caption", "Sales", "--photo", f("b.png"), "--document", f("r.pdf"), "--caption", "Full"]);
    assert.equal(r.code, 0, r.stderr);
    await until(() => shown(h).length >= 4);
    assert.deepEqual(shown(h).map((m) => m.method), ["sendMessage", "sendPhoto", "sendPhoto", "sendDocument"]);
    assert.match(String(shown(h)[0]!.body.text), /Morning report/);
    assert.deepEqual(shown(h).slice(1).map((m) => m.body.filename), ["a.png", "b.png", "r.pdf"]);
    assert.deepEqual(shown(h).slice(1).map((m) => m.body.caption), ["Sales", undefined, "Full"]);
  });
});

test("tg send --document sends a PNG as a document, not a photo", async () => {
  await withDaemon(async (h, dir) => {
    writeFileSync(path.join(dir, "a.png"), PNG);
    const r = await h.runCli(["send", "--document", path.join(dir, "a.png")]);
    assert.equal(r.code, 0, r.stderr);
    await until(() => shown(h).length >= 1);
    assert.deepEqual(shown(h).map((m) => m.method), ["sendDocument"]);
  });
});

test("tg send refuses a bad file before sending anything, and refuses mixing the old and new flags", async () => {
  await withDaemon(async (h, dir) => {
    writeFileSync(path.join(dir, "a.png"), PNG);
    const missing = await h.runCli(["send", "hello", "--photo", path.join(dir, "a.png"), "--photo", path.join(dir, "gone.png")]);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /gone\.png does not exist/);
    const mixed = await h.runCli(["send", "--photo", path.join(dir, "a.png"), "--image", path.join(dir, "a.png")]);
    assert.equal(mixed.code, 1);
    assert.match(mixed.stderr, /not both/);
    const stray = await h.runCli(["send", "--caption", "x", "hello"]);
    assert.equal(stray.code, 1);
    assert.match(stray.stderr, /--caption needs a --photo or --document/);
    await sleep(200);
    assert.equal(shown(h).length, 0);
  });
});
