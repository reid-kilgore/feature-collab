// Answering an askd set (a quiz above all) in the Mini App: the three proxy routes, askd's replies passed through,
// and the page's quiz flow. askd is a fake; the answer key lives there, never in the page.

import { test } from "node:test";
import assert from "node:assert/strict";
import type http from "node:http";
import { createMiniappServer, listenLoopback, parseMiniAnswers } from "../src/miniapp/server.ts";
import { createAskdAnswering } from "../src/miniapp/askd.ts";
import type { AskdAnswering, AskdReply } from "../src/miniapp/askd.ts";
import { renderResolvedView, renderMovedView } from "../src/transports/telegram/render.ts";
import { loadPage } from "./support/fake-dom.ts";
import { initDataFor, makeFakePort, makeStore, TEST_BOT_TOKEN } from "./support/miniapp.ts";

const SET = "a1b2c3d4e5f6";
const SECRET = "test-secret-0123456789";

function fakeAnswering(replies: Partial<Record<"view" | "check" | "submit", AskdReply>> = {}) {
  const calls: Array<{ op: string; setId: string; body?: unknown }> = [];
  const answering: AskdAnswering = {
    async view(setId) {
      calls.push({ op: "view", setId });
      return replies.view ?? { status: 200, body: { id: setId, questions: [] } };
    },
    async check(setId, body) {
      calls.push({ op: "check", setId, body });
      return replies.check ?? { status: 200, body: { value: body.value, correct: true } };
    },
    async submit(setId, body) {
      calls.push({ op: "submit", setId, body });
      return replies.submit ?? { status: 200, body: { ok: true, score: { right: 1, wrong: 0, disagree: 0, total: 1 } } };
    },
  };
  return { answering, calls };
}

async function rig(answering?: AskdAnswering) {
  const server = createMiniappServer({
    store: makeStore(),
    port: makeFakePort(),
    onResolved: () => {},
    botToken: TEST_BOT_TOKEN,
    allowedUserId: "42",
    secret: SECRET,
    maxAgeSeconds: 3600,
    askdAnswering: answering,
    log: () => {},
  });
  const bound = await listenLoopback(server, 0);
  const call = (path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}) =>
    fetch(`http://127.0.0.1:${bound}/${SECRET}/api/sets/${path}`, {
      method: init.method ?? "GET",
      headers: {
        ...(init.auth === false ? {} : { "x-telegram-init-data": initDataFor(42, Math.floor(Date.now() / 1000)) }),
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  return { call, close: () => new Promise<void>((r) => (server as http.Server).close(() => r())) };
}

test("the set routes need Telegram initData, and answer 404 when no askd is wired", async () => {
  const t = await rig(fakeAnswering().answering);
  const bare = await rig();
  try {
    assert.equal((await t.call(SET, { auth: false })).status, 401);
    assert.equal((await bare.call(SET)).status, 404);
    assert.equal((await t.call("not-an-id")).status, 404);
  } finally {
    await t.close();
    await bare.close();
  }
});

test("view, check and submit are forwarded to askd for the set, with only the whitelisted fields", async () => {
  const { answering, calls } = fakeAnswering();
  const t = await rig(answering);
  try {
    assert.equal((await t.call(SET)).status, 200);
    const check = await t.call(`${SET}/check`, { method: "POST", body: { questionId: "Q1", value: "B", extra: "dropped" } });
    assert.equal(check.status, 200);
    const submit = await t.call(`${SET}/submit`, {
      method: "POST",
      body: { answers: [{ questionId: "Q1", value: "B", notes: "n", disagree: true, answer: "C", correct: true }], annotations: { x: 1 } },
    });
    assert.deepEqual(await submit.json(), { ok: true, score: { right: 1, wrong: 0, disagree: 0, total: 1 } });
    assert.deepEqual(calls, [
      { op: "view", setId: SET },
      { op: "check", setId: SET, body: { questionId: "Q1", value: "B" } },
      { op: "submit", setId: SET, body: { answers: [{ questionId: "Q1", value: "B", notes: "n", disagree: true }], annotations: {} } },
    ]);
  } finally {
    await t.close();
  }
});

test("a malformed pick or submission is a 400 and never reaches askd", async () => {
  const { answering, calls } = fakeAnswering();
  const t = await rig(answering);
  try {
    for (const body of [{}, { questionId: "Q1" }, { questionId: "", value: "A" }, { questionId: "Q1", value: 3 }]) {
      assert.equal((await t.call(`${SET}/check`, { method: "POST", body })).status, 400);
    }
    for (const body of [{}, { answers: [] }, { answers: [{ value: "A" }] }, { answers: [{ questionId: "Q", value: { a: 1 } }] }, { answers: [{ questionId: "Q", value: "A", disagree: "yes" }] }]) {
      assert.equal((await t.call(`${SET}/submit`, { method: "POST", body })).status, 400);
    }
    assert.equal(calls.length, 0);
  } finally {
    await t.close();
  }
});

test("askd's closed-set and refusal answers pass through; any other failure is a 502", async () => {
  const closed = await rig(fakeAnswering({ view: { status: 409, body: { error: "this set is already answered" } }, submit: { status: 400, body: { error: "invalid", issues: [{ message: "bad" }] } }, check: { status: 500, body: {} } }).answering);
  try {
    assert.equal((await closed.call(SET)).status, 409);
    assert.equal((await closed.call(`${SET}/submit`, { method: "POST", body: { answers: [{ questionId: "Q", value: "A" }] } })).status, 400);
    assert.equal((await closed.call(`${SET}/check`, { method: "POST", body: { questionId: "Q", value: "A" } })).status, 502);
  } finally {
    await closed.close();
  }
});

test("parseMiniAnswers keeps a multiple-choice array and a null skip", () => {
  assert.deepEqual(parseMiniAnswers(JSON.stringify({ answers: [{ questionId: "m", value: ["a", "b"] }, { questionId: "s", value: null }] })), [
    { questionId: "m", value: ["a", "b"], notes: "" },
    { questionId: "s", value: null, notes: "" },
  ]);
});

test("createAskdAnswering calls askd's set routes, refuses a bad id without a request, and maps a network error to 502", async () => {
  const seen: Array<{ url: string; method?: string; body?: unknown }> = [];
  const fakeFetch = (async (url: string, init: { method?: string; body?: string }) => {
    seen.push({ url, method: init.method, body: init.body });
    return { status: 200, json: async () => ({ ok: true }) };
  }) as unknown as typeof fetch;
  const a = createAskdAnswering("http://127.0.0.1:8445/", { fetch: fakeFetch });
  await a.view(SET);
  await a.check(SET, { questionId: "Q1", value: "A" });
  assert.deepEqual(seen.map((s) => [s.method, s.url]), [["GET", `http://127.0.0.1:8445/sets/${SET}/api/mini`], ["POST", `http://127.0.0.1:8445/sets/${SET}/api/mini-check`]]);
  assert.equal((await a.view("../x")).status, 404);
  assert.equal(seen.length, 2);
  const down = createAskdAnswering("http://127.0.0.1:8445", { fetch: (async () => { throw new Error("refused"); }) as unknown as typeof fetch });
  assert.equal((await down.view(SET)).status, 502);
});

// ---- the page ----

const QUIZ = {
  id: SET,
  title: "Birch Coffee payroll: orientation quiz",
  message: "",
  questions: [
    { id: "Q1", type: "quiz", prompt: "What happens to a departed salary?", allowDisagree: true, options: [{ value: "A", label: "It stops" }, { value: "B", label: "It continues" }, { value: "C", label: "It is cancelled by an owner" }] },
    { id: "Q2", type: "quiz", prompt: "Who may cancel?", options: [{ value: "A", label: "Owners" }, { value: "B", label: "Anyone" }] },
  ],
};
const LIST = { readAt: "2026-11-03T02:00:00Z", batches: [{ id: SET, title: QUIZ.title, asker: "ship:x", createdAt: "2026-11-03T01:44:46Z", timeoutAt: null, total: 2, done: 0, url: `https://askd.example.ts.net:8443/sets/${SET}/` }] };

function quizPage(extra: Record<string, unknown> = {}, search = "") {
  const verdicts: Record<string, unknown> = {
    Q1: { value: "A", correct: false, answer: "C", whyWrong: "It does not stop by itself.", whyWrongAll: { A: "It does not stop by itself.", B: "It does not continue forever." }, why: "Owners cancel salaries.", cite: "Spec: cancelling a salary" },
    Q2: { value: "A", correct: true, answer: "A", whyWrong: "", whyWrongAll: { B: "Anyone is too wide." }, why: "", cite: "" },
  };
  return loadPage({
    nativeBack: true,
    openLink: true,
    search,
    routes: {
      "GET batches": { body: LIST },
      [`GET sets/${SET}`]: { body: QUIZ },
      [`POST sets/${SET}/check`]: (body) => ({ body: verdicts[JSON.parse(body ?? "{}").questionId] }),
      [`POST sets/${SET}/submit`]: { body: { ok: true, score: { right: 1, wrong: 1, disagree: 1, total: 2 } }, ...extra },
    },
  });
}

const cards = (t: ReturnType<typeof loadPage>) => t.doc.root.find((n) => n.tagName === "BUTTON" && n.className === "card");
const optionButton = (t: ReturnType<typeof loadPage>, text: RegExp) => t.doc.root.find((n) => n.tagName === "BUTTON" && n.className.startsWith("option") && text.test(n.textContent))[0]!;

test("a quiz card opens the quiz; options carry letters and the page holds no answer before a pick", async () => {
  const t = quizPage();
  await t.flush();
  t.doc.fire(cards(t)[0]!, "click");
  await t.flush();
  assert.match(t.texts(), /Question 1 of 2/);
  assert.match(t.texts(), /A\. It stops/);
  assert.match(t.texts(), /C\. It is cancelled by an owner/);
  assert.doesNotMatch(t.texts(), /Right|Wrong|Owners cancel salaries/);
  assert.equal(t.buttons("Send answers")[0]!.disabled, true);
});

test("a pick shows the verdict, the reason for each wrong option, the explanation and the disagree toggle; the answer is sent once all are picked", async () => {
  const t = quizPage();
  await t.flush();
  t.doc.fire(cards(t)[0]!, "click");
  await t.flush();
  t.doc.fire(optionButton(t, /^A\. It stops/), "click");
  await t.flush();
  assert.deepEqual(t.fetches.filter((f) => f.path.endsWith("/check")).map((f) => JSON.parse(f.body!)), [{ questionId: "Q1", value: "A" }]);
  assert.match(t.texts(), /Wrong\. The right answer is C\./);
  assert.match(t.texts(), /It does not stop by itself\./);
  assert.match(t.texts(), /It does not continue forever\./);
  assert.match(t.texts(), /Owners cancel salaries\./);
  assert.match(t.texts(), /Spec: cancelling a salary/);
  assert.equal(t.buttons("Send answers")[0]!.disabled, true, "question 2 is still open");
  const box = t.doc.root.find((n) => n.tagName === "INPUT" && n.attrs.type === "checkbox")[0]!;
  box.checked = true;
  t.doc.fire(box, "change");
  await t.flush();
  t.doc.fire(optionButton(t, /^A\. Owners/), "click");
  await t.flush();
  assert.match(t.texts(), /Right\./);
  const send = t.buttons("Send answers")[0]!;
  assert.equal(send.disabled, false);
  t.doc.fire(send, "click");
  await t.flush();
  const submitted = JSON.parse(t.fetches.find((f) => f.path.endsWith("/submit"))!.body!);
  assert.deepEqual(submitted.answers, [
    { questionId: "Q1", value: "A", notes: "", disagree: true },
    { questionId: "Q2", value: "A", notes: "" },
  ]);
  assert.match(t.texts(), /Score: 1 of 2 right/);
  assert.match(t.texts(), /You disagreed with 1\./);
});

test("a second tap on an answered quiz question does nothing", async () => {
  const t = quizPage();
  await t.flush();
  t.doc.fire(cards(t)[0]!, "click");
  await t.flush();
  t.doc.fire(optionButton(t, /^A\. It stops/), "click");
  await t.flush();
  t.doc.fire(optionButton(t, /^C\. It is cancelled/), "click");
  await t.flush();
  assert.equal(t.fetches.filter((f) => f.path.endsWith("/check")).length, 1);
});

test("opening the app with ?set= goes straight to that set", async () => {
  const t = quizPage({}, `?set=${SET}`);
  await t.flush();
  assert.match(t.texts(), /Question 1 of 2/);
});

test("a set that askd already closed returns to the list with a notice", async () => {
  const t = loadPage({ nativeBack: true, openLink: true, search: `?set=${SET}`, routes: { "GET batches": { body: LIST }, [`GET sets/${SET}`]: { status: 409, body: { error: "closed" } } } });
  await t.flush();
  assert.match(t.texts(), /already closed/);
  assert.match(t.texts(), /Open questions/);
});

// ---- the resolved view of a very long prompt ----

test("a resolved or moved question with a prompt over Telegram's limit is cut so the edit is not refused", () => {
  const long = "x".repeat(9000);
  const q = { id: "q", prompt: long, type: "single" as const };
  assert.ok(renderResolvedView(q, "answered", "y".repeat(9000)).length <= 4096);
  assert.ok(renderResolvedView(q, "skipped").length <= 4096);
  assert.ok(renderMovedView(q).length <= 4096);
  const amps = { ...q, prompt: "&".repeat(3000) };
  assert.ok(renderResolvedView(amps, "answered", "<".repeat(3000)).length <= 4096);
  assert.match(renderResolvedView(q, "expired"), /…<\/b>\n<i>⏰ expired<\/i>$/);
});

test("a short resolved view is unchanged", () => {
  assert.equal(renderResolvedView({ id: "q", prompt: "Ship it?", type: "single" }, "answered", "Yes"), "✅ <b>Ship it?</b>\n<i>Yes</i>");
});
