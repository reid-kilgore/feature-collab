// The Mini App wired into the real daemon: off unless configured, menu button and /open when
// configured, and a question asked with `tg ask` answered through the HTTP API.

import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { setupHarness, sleep, waitForSocketAt, daemonSocketPath } from "./support/harness.ts";
import type { Harness } from "./support/harness.ts";
import { resolveMiniapp } from "../src/config.ts";
import { initDataFor } from "./support/miniapp.ts";

const SECRET = "daemon-secret-0123456789";

async function waitUntil(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(30);
  }
  throw new Error("condition not met in time");
}

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

function writeConfig(h: Harness, extra: Record<string, unknown>): void {
  writeFileSync(path.join(h.home, "config", "config.json"), JSON.stringify({ chatId: h.chatId, userId: h.userId, botUsername: "fakebot", ...extra }));
}

test("without a miniapp block the daemon serves nothing, sets no menu button, and /open says so", async () => {
  const h = await setupHarness();
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    await waitUntil(() => h.fake.sent.some((m) => m.method === "setMyCommands"));
    const commands = h.fake.sent.find((m) => m.method === "setMyCommands")!.body.commands as Array<{ command: string }>;
    assert.ok(!commands.some((c) => c.command === "open"));
    // No stale menu button is left pointing at a dead URL: it is reset to the default.
    await waitUntil(() => h.fake.sent.some((m) => m.method === "setChatMenuButton"));
    assert.deepEqual(h.fake.sent.find((m) => m.method === "setChatMenuButton")!.body.menu_button, { type: "default" });

    h.fake.pushMessage({ chatId: Number(h.chatId), userId: Number(h.userId), text: "/open" });
    await waitUntil(() => h.fake.sent.some((m) => String(m.body.text ?? "").includes("not set up")));
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("with a miniapp block: menu button, /open button, and a tg ask answered through the API", async () => {
  const h = await setupHarness();
  try {
    const port = await freePort();
    writeConfig(h, { miniapp: { port, secret: SECRET, publicUrl: "https://redd.example.ts.net" } });
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));

    await waitUntil(() => h.fake.sent.some((m) => m.method === "setChatMenuButton"));
    const menu = h.fake.sent.find((m) => m.method === "setChatMenuButton")!.body;
    assert.equal(menu.chat_id, h.chatId);
    assert.deepEqual(menu.menu_button, { type: "web_app", text: "Questions", web_app: { url: `https://redd.example.ts.net/${SECRET}/` } });
    const commands = h.fake.sent.find((m) => m.method === "setMyCommands")!.body.commands as Array<{ command: string }>;
    assert.ok(commands.some((c) => c.command === "open"));

    h.fake.pushMessage({ chatId: Number(h.chatId), userId: Number(h.userId), text: "/open" });
    await waitUntil(() => h.fake.sent.some((m) => String(m.body.text ?? "") === "Your open questions:"));
    const open = h.fake.sent.find((m) => String(m.body.text ?? "") === "Your open questions:")!;
    const keyboard = (open.body.reply_markup as { inline_keyboard: Array<Array<{ web_app?: { url: string } }>> }).inline_keyboard;
    assert.equal(keyboard[0]![0]!.web_app!.url, `https://redd.example.ts.net/${SECRET}/`);

    const payload = {
      version: 1,
      title: "Daemon check",
      questions: [
        { id: "a", prompt: "Pick", type: "single", options: [{ value: "x", label: "X" }, { value: "y", label: "Y" }] },
        { id: "b", prompt: "Pick more", type: "multiple", options: [{ value: "m", label: "M" }, { value: "n", label: "N" }] },
      ],
    };
    const askProc = h.spawnCli(["ask", "--json", JSON.stringify(payload)]);
    let stdout = "";
    askProc.stdout!.on("data", (c) => (stdout += c.toString()));
    await waitUntil(() => h.fake.sent.some((m) => m.method === "sendMessage" && JSON.stringify(m.body.reply_markup ?? "").includes('"q:')));

    const base = `http://127.0.0.1:${port}/${SECRET}`;
    const headers = { "x-telegram-init-data": initDataFor(Number(h.userId), Math.floor(Date.now() / 1000), {}, "123456789:FAKE-TOKEN-FOR-TESTS-0123456789"), "content-type": "application/json" };
    assert.equal((await fetch(`${base}/api/batches`)).status, 401);
    const list = (await (await fetch(`${base}/api/batches`, { headers })).json()) as { batches: Array<{ id: string; title: string }> };
    assert.equal(list.batches.length, 1);
    assert.equal(list.batches[0]!.title, "Daemon check");

    const res = await fetch(`${base}/api/batches/${list.batches[0]!.id}/answers`, {
      method: "POST",
      headers,
      body: JSON.stringify({ answers: [{ questionId: "a", selected: ["y"] }, { questionId: "b", selected: ["m", "n"] }] }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(((await res.json()) as { results: Array<{ status: string }> }).results.map((r) => r.status), ["ok", "ok"]);

    const exitCode = await new Promise<number | null>((resolve) => askProc.once("close", resolve));
    assert.equal(exitCode, 0);
    const result = JSON.parse(stdout.trim().split("\n").pop()!);
    assert.equal(result.status, "submitted");
    assert.equal(result.answers.a.value, "y");
    assert.deepEqual(result.answers.b.value, ["m", "n"]);
    // The first question had been sent to chat; its message was edited to show the answer.
    assert.ok(h.fake.sent.some((m) => m.method === "editMessageText"));
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("a busy miniapp port is logged and the daemon still serves the CLI", async () => {
  const h = await setupHarness();
  const blocker = net.createServer();
  try {
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
    const port = (blocker.address() as net.AddressInfo).port;
    writeConfig(h, { miniapp: { port, secret: SECRET, publicUrl: "https://redd.example.ts.net" } });
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    const result = await h.runCli(["send", "--title", "Still alive", "hello"]);
    assert.equal(result.code, 0, result.stderr);
    await waitUntil(() => h.fake.sent.some((m) => m.method === "setChatMenuButton"));
    assert.deepEqual(h.fake.sent.find((m) => m.method === "setChatMenuButton")!.body.menu_button, { type: "default" });
    daemon.kill("SIGKILL");
  } finally {
    blocker.close();
    await h.teardown();
  }
});

test("resolveMiniapp accepts a good block and names the problem with a bad one", () => {
  const base = { chatId: "1", userId: "2", botUsername: "b" };
  assert.equal(resolveMiniapp(base), undefined);
  assert.deepEqual(resolveMiniapp({ ...base, miniapp: { port: 8123, secret: SECRET, publicUrl: "https://h.ts.net/ignored/path" } }), {
    port: 8123,
    secret: SECRET,
    maxAgeSeconds: 3600,
    url: `https://h.ts.net/${SECRET}/`,
  });
  const err = (m: Record<string, unknown>) => resolveMiniapp({ ...base, miniapp: { port: 8123, secret: SECRET, publicUrl: "https://h.ts.net", ...m } as never });
  assert.match((err({ port: 0 }) as { error: string }).error, /port/);
  assert.match((err({ secret: "short" }) as { error: string }).error, /secret/);
  assert.match((err({ secret: "has/slash/0123456789" }) as { error: string }).error, /secret/);
  assert.match((err({ publicUrl: "http://h.ts.net" }) as { error: string }).error, /https/);
  assert.match((err({ publicUrl: "nonsense" }) as { error: string }).error, /publicUrl/);
  assert.match((err({ maxAgeSeconds: 5 }) as { error: string }).error, /maxAgeSeconds/);
});

test("tg setup keeps the miniapp block when it rewrites config.json", async () => {
  const h = await setupHarness();
  try {
    const miniapp = { port: 8123, secret: SECRET, publicUrl: "https://redd.example.ts.net" };
    writeConfig(h, { miniapp });
    const result = await h.runCli(["setup", "--token", "999:setup-token-abcdefghijklmnopqrstuvwx", "--chat-id", "7", "--user-id", "8"]);
    assert.equal(result.code, 0, result.stderr);
    const written = JSON.parse(readFileSync(path.join(h.home, "config", "config.json"), "utf8"));
    assert.equal(written.chatId, "7");
    assert.deepEqual(written.miniapp, miniapp);
  } finally {
    await h.teardown();
  }
});

test("Open in chat through the daemon: reply to the original, old buttons dead, new buttons answer the asker", async () => {
  const h = await setupHarness();
  try {
    const port = await freePort();
    writeConfig(h, { miniapp: { port, secret: SECRET, publicUrl: "https://redd.example.ts.net" } });
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    await waitUntil(() => h.fake.sent.some((m) => m.method === "setChatMenuButton"));

    const payload = { version: 1, title: "Move me", questions: [{ id: "a", prompt: "Pick one", type: "single", options: [{ value: "x", label: "X" }, { value: "y", label: "Y" }] }] };
    const askProc = h.spawnCli(["ask", "--json", JSON.stringify(payload)]);
    let stdout = "";
    askProc.stdout!.on("data", (c) => (stdout += c.toString()));
    const isQuestion = (m: { method: string; body: Record<string, unknown> }) => m.method === "sendMessage" && JSON.stringify(m.body.reply_markup ?? "").includes('"q:');
    await waitUntil(() => h.fake.sent.some(isQuestion));
    const original = h.fake.sent.find(isQuestion)!;
    const shortId = /"q:([a-z0-9]+):s:0"/.exec(JSON.stringify(original.body.reply_markup))![1]!;

    const base = `http://127.0.0.1:${port}/${SECRET}`;
    const headers = { "x-telegram-init-data": initDataFor(Number(h.userId), Math.floor(Date.now() / 1000), {}, "123456789:FAKE-TOKEN-FOR-TESTS-0123456789"), "content-type": "application/json" };
    const list = (await (await fetch(`${base}/api/batches`, { headers })).json()) as { batches: Array<{ id: string }> };
    const res = await fetch(`${base}/api/batches/${list.batches[0]!.id}/chat`, { method: "POST", headers, body: "{}" });
    assert.deepEqual(await res.json(), { status: "ok", moved: 1 });

    // The new copy is a reply to the original, with live buttons.
    const copies = h.fake.sent.filter(isQuestion);
    assert.equal(copies.length, 2);
    assert.deepEqual(copies[1]!.body.reply_parameters, { message_id: original.messageId, allow_sending_without_reply: true });
    // The original was edited to a note with no buttons.
    const edit = h.fake.sent.find((m) => m.method === "editMessageText" && m.body.message_id === original.messageId)!;
    assert.match(String(edit.body.text), /moved to the message below/);
    assert.deepEqual(edit.body.reply_markup, { inline_keyboard: [] });

    // A tap on the OLD message is refused and does not answer the question.
    h.fake.pushCallback({ chatId: Number(h.chatId), userId: Number(h.userId), data: `q:${shortId}:s:1`, messageId: original.messageId });
    await waitUntil(() => h.fake.sent.some((m) => m.method === "answerCallbackQuery" && String(m.body.text ?? "").includes("moved")));
    assert.equal(stdout, "");
    // A tap on the NEW message answers it.
    h.fake.pushCallback({ chatId: Number(h.chatId), userId: Number(h.userId), data: `q:${shortId}:s:1`, messageId: copies[1]!.messageId });
    const exitCode = await new Promise<number | null>((resolve) => askProc.once("close", resolve));
    assert.equal(exitCode, 0);
    assert.equal(JSON.parse(stdout.trim().split("\n").pop()!).answers.a.value, "y");
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("Cancel through the daemon resolves the waiting asker as cancelled", async () => {
  const h = await setupHarness();
  try {
    const port = await freePort();
    writeConfig(h, { miniapp: { port, secret: SECRET, publicUrl: "https://redd.example.ts.net" } });
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    const payload = { version: 1, questions: [{ id: "a", prompt: "Pick", type: "single", options: [{ value: "x", label: "X" }] }] };
    const askProc = h.spawnCli(["ask", "--json", JSON.stringify(payload)]);
    let stdout = "";
    askProc.stdout!.on("data", (c) => (stdout += c.toString()));
    await waitUntil(() => h.fake.sent.some((m) => JSON.stringify(m.body.reply_markup ?? "").includes('"q:')));
    const base = `http://127.0.0.1:${port}/${SECRET}`;
    const headers = { "x-telegram-init-data": initDataFor(Number(h.userId), Math.floor(Date.now() / 1000), {}, "123456789:FAKE-TOKEN-FOR-TESTS-0123456789"), "content-type": "application/json" };
    const list = (await (await fetch(`${base}/api/batches`, { headers })).json()) as { batches: Array<{ id: string }> };
    const res = await fetch(`${base}/api/batches/${list.batches[0]!.id}/cancel`, { method: "POST", headers, body: JSON.stringify({ confirm: true }) });
    assert.deepEqual(await res.json(), { status: "ok" });
    await new Promise<number | null>((resolve) => askProc.once("close", resolve));
    assert.equal(JSON.parse(stdout.trim().split("\n").pop()!).status, "cancelled");
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("a reply to the retired reply prompt of a moved text question is told it moved, not filed as chat", async () => {
  const h = await setupHarness();
  try {
    const port = await freePort();
    writeConfig(h, { miniapp: { port, secret: SECRET, publicUrl: "https://redd.example.ts.net" } });
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    const payload = { version: 1, questions: [{ id: "a", prompt: "Say something", type: "text" }] };
    const askProc = h.spawnCli(["ask", "--json", JSON.stringify(payload)]);
    let stdout = "";
    askProc.stdout!.on("data", (c) => (stdout += c.toString()));
    const isPrompt = (m: { method: string; body: Record<string, unknown> }) => m.method === "sendMessage" && m.body.text === "Reply to this message with your answer.";
    await waitUntil(() => h.fake.sent.some(isPrompt));
    const oldPrompt = h.fake.sent.find(isPrompt)!;

    const base = `http://127.0.0.1:${port}/${SECRET}`;
    const headers = { "x-telegram-init-data": initDataFor(Number(h.userId), Math.floor(Date.now() / 1000), {}, "123456789:FAKE-TOKEN-FOR-TESTS-0123456789"), "content-type": "application/json" };
    const list = (await (await fetch(`${base}/api/batches`, { headers })).json()) as { batches: Array<{ id: string }> };
    await fetch(`${base}/api/batches/${list.batches[0]!.id}/chat`, { method: "POST", headers, body: "{}" });
    await waitUntil(() => h.fake.sent.filter(isPrompt).length === 2);

    h.fake.pushMessage({ chatId: Number(h.chatId), userId: Number(h.userId), text: "late answer", replyToMessageId: oldPrompt.messageId });
    await waitUntil(() => h.fake.sent.some((m) => String(m.body.text ?? "").startsWith("That question moved")));
    assert.equal(stdout, "");
    // It was not filed as free text for the maestro inbox either.
    assert.ok(!h.fake.sent.some((m) => String(m.body.text ?? "").startsWith("Added ")));
    // A reply to the NEW prompt answers the question.
    const newPrompt = h.fake.sent.filter(isPrompt)[1]!;
    h.fake.pushMessage({ chatId: Number(h.chatId), userId: Number(h.userId), text: "real answer", replyToMessageId: newPrompt.messageId });
    await new Promise<number | null>((resolve) => askProc.once("close", resolve));
    assert.equal(JSON.parse(stdout.trim().split("\n").pop()!).answers.a.value, "real answer");
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("the menu button text follows the number of open sets through the daemon", async () => {
  const h = await setupHarness();
  try {
    const port = await freePort();
    writeConfig(h, { miniapp: { port, secret: SECRET, publicUrl: "https://redd.example.ts.net" } });
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    const texts = () => h.fake.sent.filter((m) => m.method === "setChatMenuButton").map((m) => (m.body.menu_button as { text: string }).text);
    await waitUntil(() => texts().length === 1);
    assert.deepEqual(texts(), ["Questions"]);

    const payload = { version: 1, questions: [{ id: "a", prompt: "Pick", type: "single", options: [{ value: "x", label: "X" }] }] };
    const askProc = h.spawnCli(["ask", "--json", JSON.stringify(payload)]);
    await waitUntil(() => texts().includes("Questions (1)"), 6000);
    const shortId = /"q:([a-z0-9]+):s:0"/.exec(JSON.stringify(h.fake.sent.find((m) => JSON.stringify(m.body.reply_markup ?? "").includes('"q:'))!.body.reply_markup))![1]!;
    h.fake.pushCallback({ chatId: Number(h.chatId), userId: Number(h.userId), data: `q:${shortId}:s:0` });
    await new Promise<number | null>((resolve) => askProc.once("close", resolve));
    await waitUntil(() => texts().at(-1) === "Questions", 6000);
    assert.deepEqual(texts(), ["Questions", "Questions (1)", "Questions"]);
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});
