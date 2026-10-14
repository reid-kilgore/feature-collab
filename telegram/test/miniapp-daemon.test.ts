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
