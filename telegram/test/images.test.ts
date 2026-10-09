// Pictures in tg ask: image documents, markdown images, and mermaid/svg fences become
// Telegram photos. The renderer is injected; no Chromium is launched here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FakeTelegram } from "./support/fake-telegram.ts";
import { setupHarness, sleep, waitForSocketAt, daemonSocketPath } from "./support/harness.ts";
import { TelegramApi } from "../src/transports/telegram/api.ts";
import { createTelegramPort } from "../src/transports/telegram/handler.ts";
import { extractDiagrams, extractMarkdownImageRefs } from "../src/core/diagrams.ts";
import { findChromium } from "../src/transports/telegram/diagram-render.ts";
import { validatePayload, ContractError } from "../src/contract/payload.ts";
import type { AskPayload } from "../src/contract/payload.ts";
import type { BatchRow } from "../src/core/store.ts";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

async function withPort<T>(
  render: (kind: string, source: string) => Promise<string>,
  fn: (port: ReturnType<typeof createTelegramPort>, fake: FakeTelegram, dir: string) => Promise<T>,
): Promise<T> {
  const fake = new FakeTelegram();
  await fake.start();
  const dir = mkdtempSync(path.join(os.tmpdir(), "agent-telegram-img-"));
  try {
    const port = createTelegramPort(new TelegramApi("1:FAKE", fake.baseUrl), "host", render as never);
    return await fn(port, fake, dir);
  } finally {
    await fake.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}

const batch = { chat_id: "1001" } as BatchRow;
const base: Omit<AskPayload, "documents" | "message"> = { version: 1, title: "T", questions: [{ id: "q", prompt: "p", type: "text" }] };

function stubRender(dir: string) {
  const calls: Array<{ kind: string; source: string }> = [];
  const fn = async (kind: string, source: string) => {
    calls.push({ kind, source });
    const file = path.join(dir, `r${calls.length}.png`);
    writeFileSync(file, PNG);
    return file;
  };
  return { calls, fn };
}

test("an image document is sent as a photo with the title as caption, not as a file", async () => {
  await withPort(async () => "unused", async (port, fake, dir) => {
    const img = path.join(dir, "shot.png");
    writeFileSync(img, PNG);
    await port.sendHeader(batch, { ...base, documents: [{ id: "d", title: "Before & after", path: img }] });
    const photos = fake.sent.filter((m) => m.method === "sendPhoto");
    assert.equal(photos.length, 1);
    assert.equal(photos[0]!.body.caption, "Before &amp; after");
    assert.equal(photos[0]!.body.filename, "shot.png");
    assert.equal(fake.sent.filter((m) => m.method === "sendDocument").length, 0);
  });
});

test("a markdown document sends its text then its images as photos, in order", async () => {
  await withPort(async () => "unused", async (port, fake, dir) => {
    const a = path.join(dir, "a.png");
    const b = path.join(dir, "b.jpg");
    writeFileSync(a, PNG);
    writeFileSync(b, PNG);
    await port.sendHeader(batch, { ...base, documents: [{ id: "d", title: "Doc", markdown: "hi ![x](a.png) ![y](b.jpg)", images: [a, b] }] });
    assert.deepEqual(fake.sent.map((m) => m.method), ["sendMessage", "sendDocument", "sendPhoto", "sendPhoto"]);
    assert.deepEqual(fake.sent.filter((m) => m.method === "sendPhoto").map((m) => m.body.filename), ["a.png", "b.jpg"]);
  });
});

test("a mermaid fence in a document is rendered and sent as a photo captioned with title and diagram number", async () => {
  await withPort(async () => "unused", async (_unused, fake, dir) => {
    const r = stubRender(dir);
    const port = createTelegramPort(new TelegramApi("1:FAKE", fake.baseUrl), "host", r.fn as never);
    const md = "before\n```mermaid\ngraph TD; A-->B\n```\nmiddle\n```svg\n<svg xmlns='http://www.w3.org/2000/svg'/>\n```\nafter";
    await port.sendHeader(batch, { ...base, documents: [{ id: "d", title: "Plan", markdown: md }] });
    assert.deepEqual(r.calls.map((c) => c.kind), ["mermaid", "svg"]);
    assert.equal(r.calls[0]!.source, "graph TD; A-->B");
    const photos = fake.sent.filter((m) => m.method === "sendPhoto");
    assert.deepEqual(photos.map((m) => m.body.caption), ["Plan — diagram 1", "Plan — diagram 2"]);
    assert.equal(fake.sent.filter((m) => m.method === "sendDocument").length, 1);
  });
});

test("a fence in the message is rendered too", async () => {
  await withPort(async () => "unused", async (_unused, fake, dir) => {
    const r = stubRender(dir);
    const port = createTelegramPort(new TelegramApi("1:FAKE", fake.baseUrl), "host", r.fn as never);
    await port.sendHeader(batch, { ...base, message: "see:\n```mermaid\ngraph TD; A-->B\n```" });
    assert.equal(r.calls.length, 1);
    const header = fake.sent.find((m) => m.method === "sendMessage")!;
    assert.doesNotMatch(String(header.body.text), /graph TD/);
    assert.equal(fake.sent.filter((m) => m.method === "sendPhoto")[0]!.body.caption, "T — diagram 1");
  });
});

test("when rendering fails the source is sent as a code block and a warning names the reason", async () => {
  const warnings: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void warnings.push(args.join(" "));
  try {
    await withPort(async () => { throw new Error("no Chromium binary found"); }, async (port, fake) => {
      await port.sendHeader(batch, { ...base, documents: [{ id: "d", title: "Plan", markdown: "```mermaid\ngraph TD; A-->B\n```" }] });
      assert.equal(fake.sent.filter((m) => m.method === "sendPhoto").length, 0);
      const code = fake.sent.filter((m) => m.method === "sendMessage").pop()!;
      assert.match(String(code.body.text), /<pre>graph TD; A--&gt;B<\/pre>/);
    });
  } finally {
    console.error = original;
  }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /could not render mermaid diagram 1.*no Chromium binary found/);
});

test("extractDiagrams and extractMarkdownImageRefs", () => {
  const { text, diagrams } = extractDiagrams("a\n```mermaid\nX\n```\n```js\nnot me\n```\n");
  assert.equal(diagrams.length, 1);
  assert.match(text, /\[diagram 1\]/);
  assert.match(text, /not me/);
  assert.deepEqual(extractMarkdownImageRefs("![a](one.png) ![b](https://x/y.png) ![c](sub/two%20x.png \"t\")\n```\n![d](in-fence.png)\n```"), ["one.png", "sub/two x.png"]);
});

test("findChromium honours TG_CHROMIUM and picks the newest Playwright build", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "agent-telegram-chromium-"));
  try {
    for (const n of ["1234", "1243"]) {
      const bin = path.join(home, "Library", "Caches", "ms-playwright", `chromium-${n}`, "chrome-mac-arm64", "Chromium.app", "Contents", "MacOS");
      mkdirSync(bin, { recursive: true });
      writeFileSync(path.join(bin, "Chromium"), "");
    }
    assert.match(findChromium({}, home), /chromium-1243/);
    const override = path.join(home, "mine");
    writeFileSync(override, "");
    assert.equal(findChromium({ TG_CHROMIUM: override }, home), override);
    assert.throws(() => findChromium({ TG_CHROMIUM: path.join(home, "missing") }, home), /does not exist/);
    assert.throws(() => findChromium({}, path.join(home, "nowhere")), /no Chromium found/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a documents entry with the wrong keys is refused with a message naming the required keys", () => {
  const bad = { ...base, documents: [{ id: "d", title: "T", content: "hello" }] };
  try {
    validatePayload(bad);
    assert.fail("should have thrown");
  } catch (error) {
    assert.ok(error instanceof ContractError);
    const text = (error as ContractError).issues.map((i) => i.message).join("\n");
    assert.match(text, /\{id, title, markdown\} or \{id, title, path\}/);
    assert.match(text, /documents\[0\]\.content|not a document key/);
  }
});

// ---- through the real CLI and daemon ----

async function askAndCollect(files: Record<string, Buffer | string>, payload: unknown, until: (sent: FakeTelegram["sent"]) => boolean) {
  const h = await setupHarness();
  const dir = mkdtempSync(path.join(os.tmpdir(), "aq-img-"));
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    for (const [name, data] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      writeFileSync(path.join(dir, name), data);
    }
    const file = path.join(dir, "request.json");
    writeFileSync(file, JSON.stringify(payload));
    const proc = h.spawnCli(["ask", "--file", file]);
    let stderr = "";
    proc.stderr!.on("data", (c) => (stderr += c.toString()));
    const closed = new Promise<number | null>((resolve) => proc.once("close", resolve));
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !until(h.fake.sent) && proc.exitCode === null) await sleep(30);
    const sent = [...h.fake.sent];
    if (proc.exitCode === null) proc.kill("SIGKILL");
    const code = await closed;
    daemon.kill("SIGKILL");
    return { sent, stderr, code };
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await h.teardown();
  }
}

const q = [{ id: "q", prompt: "p", type: "text" }];

test("tg ask sends an image path and a markdown image as photos", async () => {
  const { sent, stderr } = await askAndCollect(
    { "pics/a.png": PNG, "pics/b.png": PNG, "doc.md": "see ![b](pics/b.png)\n" },
    { version: 1, questions: q, documents: [{ id: "i", title: "Shot", path: "pics/a.png" }, { id: "m", title: "Doc", path: "doc.md" }] },
    (s) => s.filter((m) => m.method === "sendPhoto").length >= 2,
  );
  const photos = sent.filter((m) => m.method === "sendPhoto");
  assert.equal(photos.length, 2, stderr);
  assert.deepEqual(photos.map((m) => m.body.filename), ["a.png", "b.png"]);
  assert.equal(photos[0]!.body.caption, "Shot");
  assert.equal(sent.filter((m) => m.method === "sendDocument").length, 1);
});

test("tg ask refuses an image path or markdown image that leaves the payload directory", async () => {
  for (const documents of [
    [{ id: "i", title: "Shot", path: "../outside.png" }],
    [{ id: "m", title: "Doc", markdown: "![x](../outside.png)" }],
    [{ id: "i", title: "Shot", path: "/etc/hosts.png" }],
  ]) {
    const { sent, stderr, code } = await askAndCollect({}, { version: 1, questions: q, documents }, () => false);
    assert.equal(code, 1);
    assert.match(stderr, /path must (stay within|be relative)/);
    assert.equal(sent.filter((m) => m.method === "sendPhoto").length, 0);
  }
});

test("tg ask names the required document keys when given {title, content}", async () => {
  const { stderr, code } = await askAndCollect({}, { version: 1, questions: q, documents: [{ id: "d", title: "T", content: "x" }] }, () => false);
  assert.equal(code, 1);
  assert.match(stderr, /\{id, title, markdown\} or \{id, title, path\}/);
});
