// askd is the source of truth for what is waiting: the Mini App list and the menu button count follow
// askd's open sets. A set with a live batch is answered in the app; any other set is a card that opens its form.
// All addresses here are fakes.

import { test } from "node:test";
import assert from "node:assert/strict";
import type http from "node:http";
import { startBatch } from "../src/core/interaction.ts";
import { createMiniappServer, listenLoopback } from "../src/miniapp/server.ts";
import { fetchAskdSets, parseAskdSets } from "../src/miniapp/askd.ts";
import type { AskdSet } from "../src/miniapp/askd.ts";
import { mergedListView, listView } from "../src/miniapp/views.ts";
import { createMenuCountUpdater } from "../src/miniapp/menu-count.ts";
import { resolveAskdUrl, DEFAULT_ASKD_URL } from "../src/config.ts";
import type { Config } from "../src/config.ts";
import { loadPage } from "./support/fake-dom.ts";
import { createBatch, initDataFor, makeFakePort, makeStore, THREE_QUESTIONS, TEST_BOT_TOKEN } from "./support/miniapp.ts";

const FORM = "https://askd.example.ts.net:8443/sets";
const askdRow = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  id,
  state: "open",
  title,
  url: `${FORM}/${id}/`,
  asker: { session: "composer", laptop: "duo", tmux: "MAESTRO:COMPOSER.0" },
  createdAt: "2026-11-03T01:44:46Z",
  expiresAt: "2026-11-03T13:44:46Z",
  questions: 11,
  telegram: { state: "link", note: "a quiz" },
  ...extra,
});
const set = (id: string, title: string, extra: Partial<AskdSet> = {}): AskdSet => ({
  id,
  title,
  url: `${FORM}/${id}/`,
  asker: "ship:x",
  createdAt: "2026-11-03T01:44:46Z",
  expiresAt: null,
  questions: 2,
  ...extra,
});

const A = "a".repeat(12);
const B = "b".repeat(12);
const C = "c".repeat(12);
const D = "d".repeat(12);

test("askd's list is read row by row, and rows that are not open sets are dropped", () => {
  const rows = parseAskdSets([
    askdRow(A, "Quiz"),
    askdRow("not-an-id", "Bad id"),
    askdRow(B, "Closed", { state: "answered" }),
    askdRow(C, "Script link", { url: "javascript:alert(1)" }),
    null,
    "text",
    askdRow(D, "", { asker: {} }),
  ]);
  assert.deepEqual(rows!.map((r) => [r.id, r.title, r.asker, r.questions]), [[A, "Quiz", "MAESTRO:COMPOSER.0", 11], [D, "(untitled)", "", 11]]);
  assert.equal(parseAskdSets({ sets: [] }), undefined);
});

test("fetchAskdSets asks for the open sets, and any failure is undefined, never an error", async () => {
  const seen: string[] = [];
  const ok = (async (url: string) => {
    seen.push(url);
    return new Response(JSON.stringify([askdRow(A, "Quiz")]));
  }) as unknown as typeof fetch;
  assert.equal((await fetchAskdSets("http://127.0.0.1:1/", { fetch: ok }))!.length, 1);
  assert.deepEqual(seen, ["http://127.0.0.1:1/api/sets?state=open"]);
  const down = (async () => {
    throw new Error("refused");
  }) as unknown as typeof fetch;
  assert.equal(await fetchAskdSets("http://127.0.0.1:1", { fetch: down }), undefined);
  const bad = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
  assert.equal(await fetchAskdSets("http://127.0.0.1:1", { fetch: bad }), undefined);
  const junk = (async () => new Response("<html>")) as unknown as typeof fetch;
  assert.equal(await fetchAskdSets("http://127.0.0.1:1", { fetch: junk }), undefined);
});

test("the list is askd's open sets in askd's order; a set without a live batch is a card with its form url", async () => {
  const store = makeStore();
  const port = makeFakePort();
  const live = createBatch(store, { ...THREE_QUESTIONS, title: "Live in the app" }, { askKey: `askd-${B}` });
  const direct = createBatch(store, { ...THREE_QUESTIONS, title: "Plain tg ask" });
  const stale = createBatch(store, { ...THREE_QUESTIONS, title: "Set askd closed" }, { askKey: `askd-${D}` });
  for (const id of [live, direct, stale]) await startBatch(store, port, id);

  const view = mergedListView(store, [set(A, "Quiz"), set(B, "Live in the app"), set(C, "Failed send")]);
  assert.deepEqual(view.batches.map((b) => b.title), ["Quiz", "Live in the app", "Failed send", "Plain tg ask"]);
  const byTitle = Object.fromEntries(view.batches.map((b) => [b.title, b]));
  assert.equal(byTitle["Quiz"]!.url, `${FORM}/${A}/`);
  assert.equal(byTitle["Quiz"]!.total, 2);
  assert.equal(byTitle["Failed send"]!.url, `${FORM}/${C}/`);
  assert.equal(byTitle["Live in the app"]!.id, live, "a live batch keeps in-app answering");
  assert.equal(byTitle["Live in the app"]!.url, undefined);
  assert.equal(byTitle["Plain tg ask"]!.url, undefined);
  assert.ok(!view.batches.some((b) => b.title === "Set askd closed"), "a batch for a set askd does not list is left out");
});

test("with askd unreachable the list is this daemon's own batches, as before", async () => {
  const store = makeStore();
  const port = makeFakePort();
  const id = createBatch(store, THREE_QUESTIONS, { askKey: `askd-${A}` });
  await startBatch(store, port, id);
  const now = new Date();
  assert.deepEqual(mergedListView(store, undefined, now), listView(store, now));
  assert.equal(mergedListView(store, undefined, now).batches.length, 1);
});

test("the menu button count is askd's open count", async () => {
  const store = makeStore();
  const port = makeFakePort();
  await startBatch(store, port, createBatch(store, THREE_QUESTIONS, { askKey: `askd-${B}` }));
  let askd: AskdSet[] | undefined = [set(A, "Quiz"), set(B, "Live"), set(C, "Failed send"), set(D, "Link only")];
  const sent: string[] = [];
  const updater = createMenuCountUpdater({
    getCount: async () => mergedListView(store, askd).batches.length,
    setText: async (text) => void sent.push(text),
    log: () => {},
    debounceMs: 5,
  });
  await updater.syncNow();
  assert.deepEqual(sent, ["Questions (4)"], "the quiz, failed and link-only sets count with the live one");
  askd = [set(A, "Quiz")];
  updater.schedule();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(sent.at(-1), "Questions (1)");
  updater.stop();
});

test("GET /api/batches serves the merged list", async () => {
  const store = makeStore();
  const port = makeFakePort();
  await startBatch(store, port, createBatch(store, { ...THREE_QUESTIONS, title: "Live" }, { askKey: `askd-${B}` }));
  const server = createMiniappServer({
    store,
    port,
    onResolved: () => {},
    botToken: TEST_BOT_TOKEN,
    allowedUserId: "42",
    secret: "test-secret-0123456789",
    maxAgeSeconds: 3600,
    askd: async () => [set(A, "Quiz"), set(B, "Live")],
    log: () => {},
  });
  const bound = await listenLoopback(server, 0);
  try {
    const res = await fetch(`http://127.0.0.1:${bound}/test-secret-0123456789/api/batches`, {
      headers: { "x-telegram-init-data": initDataFor(42, Math.floor(Date.now() / 1000)) },
    });
    const body = (await res.json()) as { batches: Array<{ title: string; url?: string }> };
    assert.deepEqual(body.batches.map((b) => [b.title, b.url ?? null]), [["Quiz", `${FORM}/${A}/`], ["Live", null]]);
  } finally {
    await new Promise<void>((r) => (server as http.Server).close(() => r()));
  }
});

test("a card for a set without a batch opens its form in the browser and has no answer screen", async () => {
  const url = `${FORM}/${A}/`;
  const t = loadPage({
    nativeBack: true,
    openLink: true,
    routes: {
      "GET batches": {
        body: {
          readAt: "2026-11-03T02:00:00Z",
          batches: [{ id: A, title: "Quiz", asker: "ship:x", createdAt: "2026-11-03T01:44:46Z", timeoutAt: null, total: 11, done: 0, url }],
        },
      },
    },
  });
  await t.flush();
  const card = t.doc.root.find((n) => n.tagName === "BUTTON" && n.className === "card")[0]!;
  assert.match(card.textContent, /11 questions/);
  t.doc.fire(card, "click");
  await t.flush();
  assert.ok(t.calls.includes(`openLink ${url}`));
  assert.ok(!t.calls.some((c) => c.startsWith("GET batches/")), "no detail request for a set the app cannot answer");
});

test("askd's address comes from ASKD_URL, then config, then the loopback default; other hosts are skipped", () => {
  const cfg = (askdUrl?: string) => ({ chatId: "1", userId: "1", botUsername: "b", miniapp: { port: 1, secret: "x", publicUrl: "https://a", askdUrl } }) as Config;
  assert.equal(resolveAskdUrl(cfg("http://127.0.0.1:9/x"), { ASKD_URL: "https://box.example.ts.net:8443/p" }), "https://box.example.ts.net:8443");
  assert.equal(resolveAskdUrl(cfg("http://100.101.102.103:9/x"), {}), "http://100.101.102.103:9");
  assert.equal(resolveAskdUrl(cfg("http://127.0.0.1:9/x"), {}), "http://127.0.0.1:9");
  assert.equal(resolveAskdUrl(cfg("http://example.com/"), { ASKD_URL: "http://8.8.8.8:1" }), DEFAULT_ASKD_URL);
  assert.equal(resolveAskdUrl(cfg("javascript:alert(1)"), { ASKD_URL: "nope" }), DEFAULT_ASKD_URL);
  assert.equal(resolveAskdUrl({ chatId: "1", userId: "1", botUsername: "b" }, {}), DEFAULT_ASKD_URL);
});
