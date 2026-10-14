// The Mini App HTTP server in-process: routing, the initData lock, response shapes, and the
// submit path. Uses a fake port, so nothing reaches Telegram.

import { test } from "node:test";
import assert from "node:assert/strict";
import type http from "node:http";
import { startBatch, cancelBatch } from "../src/core/interaction.ts";
import { createMiniappServer, listenLoopback, parseSubmissions } from "../src/miniapp/server.ts";
import type { AskResult } from "../src/contract/payload.ts";
import { createBatch, initDataFor, makeFakePort, makeStore, THREE_QUESTIONS, TEST_BOT_TOKEN } from "./support/miniapp.ts";

const SECRET = "test-secret-0123456789";
const USER = 42;

async function rig() {
  const store = makeStore();
  const port = makeFakePort();
  const results: AskResult[] = [];
  const logs: string[] = [];
  const server = createMiniappServer({
    store,
    port,
    onResolved: (_id, r) => results.push(r),
    botToken: TEST_BOT_TOKEN,
    allowedUserId: String(USER),
    secret: SECRET,
    maxAgeSeconds: 3600,
    log: (l) => logs.push(l),
  });
  const bound = await listenLoopback(server, 0);
  const url = (p: string) => `http://127.0.0.1:${bound}/${SECRET}${p}`;
  const now = () => Math.floor(Date.now() / 1000);
  const auth = (userId = USER, authDate = now()) => ({ "x-telegram-init-data": initDataFor(userId, authDate) });
  return { store, port, results, logs, server, url, auth, close: () => new Promise<void>((r) => (server as http.Server).close(() => r())) };
}

test("the page shell is public and carries no data, with a strict content security policy", async () => {
  const t = await rig();
  try {
    createBatch(t.store, THREE_QUESTIONS);
    const html = await fetch(t.url("/"));
    assert.equal(html.status, 200);
    const body = await html.text();
    assert.match(body, /telegram-web-app\.js/);
    assert.doesNotMatch(body, /Pick a plan|Which database/);
    assert.doesNotMatch(body, new RegExp(TEST_BOT_TOKEN));
    assert.match(html.headers.get("content-security-policy")!, /script-src 'self' https:\/\/telegram\.org/);
    assert.equal(html.headers.get("referrer-policy"), "no-referrer");
    assert.equal((await fetch(t.url("/app.js"))).status, 200);
    assert.equal((await fetch(t.url("/app.css"))).status, 200);
    // Without the trailing slash the relative script paths would break, so it redirects.
    const redirect = await fetch(`http://127.0.0.1:${(t.server.address() as { port: number }).port}/${SECRET}`, { redirect: "manual" });
    assert.equal(redirect.status, 308);
  } finally {
    await t.close();
  }
});

test("a wrong or missing secret path is a bare 404, even for the API", async () => {
  const t = await rig();
  try {
    const port = (t.server.address() as { port: number }).port;
    for (const p of ["/", "/wrong/", "/wrong/api/batches", `/${SECRET}x/api/batches`, "/api/batches"]) {
      const res = await fetch(`http://127.0.0.1:${port}${p}`, { headers: t.auth() });
      assert.equal(res.status, 404, p);
      assert.equal(await res.text(), "");
    }
  } finally {
    await t.close();
  }
});

test("every API route answers 401 with an empty body for missing, tampered, expired, and wrong-user initData", async () => {
  const t = await rig();
  try {
    const batchId = createBatch(t.store, THREE_QUESTIONS);
    const tampered = new URLSearchParams(initDataFor(USER, Math.floor(Date.now() / 1000)));
    tampered.set("user", JSON.stringify({ id: 43 }));
    const bad: Array<Record<string, string>> = [
      {},
      { "x-telegram-init-data": "" },
      { "x-telegram-init-data": tampered.toString() },
      t.auth(USER, Math.floor(Date.now() / 1000) - 4000),
      t.auth(43),
    ];
    for (const headers of bad) {
      for (const [method, p] of [["GET", "/api/batches"], ["GET", `/api/batches/${batchId}`], ["POST", `/api/batches/${batchId}/answers`]] as const) {
        const res = await fetch(t.url(p), { method, headers: { ...headers, "content-type": "application/json" }, body: method === "POST" ? JSON.stringify({ answers: [{ questionId: "q1", selected: ["pg"] }] }) : undefined });
        assert.equal(res.status, 401, `${method} ${p}`);
        assert.equal(await res.text(), "");
      }
    }
    // The 401s changed nothing.
    assert.equal(t.store.listQuestionsForBatch(batchId)[0]!.status, "waiting");
  } finally {
    await t.close();
  }
});

test("the list shows open batches only, newest first, with the fields a card shows", async () => {
  const t = await rig();
  try {
    const older = createBatch(t.store, { ...THREE_QUESTIONS, title: "Older" }, { tmuxWindow: "ship:old" });
    await new Promise((r) => setTimeout(r, 5));
    const newer = createBatch(t.store, { ...THREE_QUESTIONS, title: "Newer" });
    const cancelled = createBatch(t.store, { ...THREE_QUESTIONS, title: "Cancelled" });
    const expired = createBatch(t.store, { ...THREE_QUESTIONS, title: "Past deadline" }, { timeoutAt: new Date(Date.now() - 1000).toISOString() });
    for (const id of [older, newer, cancelled, expired]) await startBatch(t.store, t.port, id);
    await cancelBatch(t.store, t.port, () => {}, cancelled);

    const res = await fetch(t.url("/api/batches"), { headers: t.auth() });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type")!, /application\/json/);
    const body = (await res.json()) as { readAt: string; batches: Array<Record<string, unknown>> };
    assert.ok(!Number.isNaN(Date.parse(body.readAt)));
    assert.deepEqual(body.batches.map((b) => b.title), ["Newer", "Older"]);
    assert.deepEqual(Object.keys(body.batches[1]!).sort(), ["asker", "createdAt", "done", "id", "timeoutAt", "title", "total"]);
    assert.equal(body.batches[1]!.asker, "ship:old");
    assert.equal(body.batches[0]!.asker, "/tmp/project");
    assert.equal(body.batches[0]!.total, 3);
    assert.equal(body.batches[0]!.done, 0);
    const text = JSON.stringify(body);
    assert.ok(!text.includes(TEST_BOT_TOKEN));
    assert.ok(!text.includes("chat_id") && !text.includes("message_id"));
  } finally {
    await t.close();
  }
});

test("the detail view strips (Recommended), marks it, and hides ids and resolved batches", async () => {
  const t = await rig();
  try {
    const id = createBatch(t.store, THREE_QUESTIONS);
    await startBatch(t.store, t.port, id);
    const res = await fetch(t.url(`/api/batches/${id}`), { headers: t.auth() });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { title: string; questions: Array<Record<string, unknown>> };
    assert.equal(body.title, "Pick a plan");
    assert.equal(body.questions.length, 3);
    const q1 = body.questions[0] as { options: Array<{ label: string; recommended: boolean }>; state: string; skippable: boolean; allowOther: boolean };
    assert.deepEqual(q1.options.map((o) => [o.label, o.recommended]), [["Postgres", true], ["SQLite", false]]);
    assert.equal(q1.state, "open");
    assert.equal(q1.skippable, false);
    assert.equal(q1.allowOther, true);
    const q3 = body.questions[2] as { type: string; skippable: boolean; allowOther: boolean };
    assert.deepEqual([q3.type, q3.skippable, q3.allowOther], ["text", true, false]);
    assert.ok(!JSON.stringify(body).includes("message_id"));

    assert.equal((await fetch(t.url("/api/batches/ffffffffffffffffffffffff"), { headers: t.auth() })).status, 404);
    assert.equal((await fetch(t.url("/api/batches/not-an-id"), { headers: t.auth() })).status, 404);
    await cancelBatch(t.store, t.port, () => {}, id);
    assert.equal((await fetch(t.url(`/api/batches/${id}`), { headers: t.auth() })).status, 404);
  } finally {
    await t.close();
  }
});

test("submitting answers resolves the asker and the response reports each question", async () => {
  const t = await rig();
  try {
    const id = createBatch(t.store, THREE_QUESTIONS);
    await startBatch(t.store, t.port, id);
    const res = await fetch(t.url(`/api/batches/${id}/answers`), {
      method: "POST",
      headers: { ...t.auth(), "content-type": "application/json" },
      body: JSON.stringify({ answers: [{ questionId: "q1", selected: ["pg"] }, { questionId: "q2", selected: ["us"] }, { questionId: "q3", skip: true }] }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { batchStatus: string; results: Array<{ questionId: string; status: string }> };
    assert.equal(body.batchStatus, "submitted");
    assert.deepEqual(body.results.map((r) => [r.questionId, r.status]), [["q1", "ok"], ["q2", "ok"], ["q3", "ok"]]);
    assert.equal(t.results.length, 1);
    assert.equal(t.results[0]!.answers.q3!.value, null);
    // A second submit of the same batch is a per-question conflict, not a server error.
    const again = await fetch(t.url(`/api/batches/${id}/answers`), {
      method: "POST",
      headers: { ...t.auth(), "content-type": "application/json" },
      body: JSON.stringify({ answers: [{ questionId: "q1", selected: ["sqlite"] }] }),
    });
    assert.equal(again.status, 200);
    const againBody = (await again.json()) as { batchStatus: string; results: Array<{ status: string }> };
    assert.equal(againBody.batchStatus, "submitted");
    assert.equal(againBody.results[0]!.status, "conflict");
    assert.equal(t.results.length, 1);
  } finally {
    await t.close();
  }
});

test("malformed submit bodies are 400 and change nothing", async () => {
  const t = await rig();
  try {
    const id = createBatch(t.store, THREE_QUESTIONS);
    await startBatch(t.store, t.port, id);
    const send = (body: string, contentType = "application/json") =>
      fetch(t.url(`/api/batches/${id}/answers`), { method: "POST", headers: { ...t.auth(), "content-type": contentType }, body });
    assert.equal((await send("not json")).status, 400);
    assert.equal((await send("{}")).status, 400);
    assert.equal((await send(JSON.stringify({ answers: [] }))).status, 400);
    assert.equal((await send(JSON.stringify({ answers: [{ questionId: 7 }] }))).status, 400);
    assert.equal((await send(JSON.stringify({ answers: [{ questionId: "q1", selected: "pg" }] }))).status, 400);
    assert.equal((await send(JSON.stringify({ answers: "x" }), "text/plain")).status, 415);
    assert.equal((await send(JSON.stringify({ answers: [{ questionId: "q1", text: "x".repeat(70_000) }] }))).status, 413);
    assert.equal(t.store.listQuestionsForBatch(id)[0]!.status, "pending");
    assert.equal((await fetch(t.url(`/api/batches/${id}`), { method: "DELETE", headers: t.auth() })).status, 405);
  } finally {
    await t.close();
  }
});

test("an error inside a request becomes a bare 500 and the server keeps serving", async () => {
  const t = await rig();
  try {
    const id = createBatch(t.store, THREE_QUESTIONS);
    // Corrupt the stored payload so building the view throws.
    t.store.db.prepare("UPDATE batches SET payload_json = ? WHERE id = ?").run("{not json", id);
    const bad = await fetch(t.url("/api/batches"), { headers: t.auth() });
    assert.equal(bad.status, 500);
    assert.equal(await bad.text(), "");
    assert.ok(t.logs.some((l) => l.startsWith("miniapp request error")));
    t.store.db.prepare("DELETE FROM batches WHERE id = ?").run(id);
    assert.equal((await fetch(t.url("/api/batches"), { headers: t.auth() })).status, 200);
  } finally {
    await t.close();
  }
});

test("parseSubmissions accepts the documented shapes and rejects the rest", () => {
  assert.deepEqual(parseSubmissions(JSON.stringify({ answers: [{ questionId: "a", selected: ["x"], other: "y" }, { questionId: "b", text: "t" }, { questionId: "c", skip: true }] })), [
    { questionId: "a", selected: ["x"], other: "y" },
    { questionId: "b", text: "t" },
    { questionId: "c", skip: true },
  ]);
  assert.equal(parseSubmissions(JSON.stringify({ answers: [{ questionId: "a", skip: "yes" }] })), undefined);
  assert.equal(parseSubmissions(JSON.stringify({ answers: [null] })), undefined);
});

test("a request path starting with // is a bare 404 and is not logged", async () => {
  const t = await rig();
  try {
    const port = (t.server.address() as { port: number }).port;
    const { request } = await import("node:http");
    for (const p of ["//", "//x/y", "/"]) {
      const status = await new Promise<number>((resolve, reject) => {
        const req = request({ host: "127.0.0.1", port, path: p, method: "GET" }, (res) => {
          res.resume();
          resolve(res.statusCode!);
        });
        req.on("error", reject);
        req.end();
      });
      assert.equal(status, 404, p);
    }
    assert.deepEqual(t.logs, []);
  } finally {
    await t.close();
  }
});

test("the server caps open connections", async () => {
  const t = await rig();
  try {
    assert.equal(t.server.maxConnections, 64);
  } finally {
    await t.close();
  }
});

test("a question id longer than 200 characters is accepted, an absurd one is not", () => {
  const long = "q".repeat(500);
  assert.ok(parseSubmissions(JSON.stringify({ answers: [{ questionId: long, skip: true }] })));
  assert.equal(parseSubmissions(JSON.stringify({ answers: [{ questionId: "q".repeat(1001), skip: true }] })), undefined);
});

test("question ids named like Object.prototype members work end to end", async () => {
  const t = await rig();
  try {
    const payload = {
      version: 1 as const,
      questions: [
        { id: "__proto__", prompt: "A", type: "single" as const, options: [{ value: "x", label: "X" }] },
        { id: "constructor", prompt: "B", type: "text" as const },
      ],
    };
    const id = createBatch(t.store, payload);
    await startBatch(t.store, t.port, id);
    const detail = (await (await fetch(t.url(`/api/batches/${id}`), { headers: t.auth() })).json()) as { questions: Array<{ id: string }> };
    assert.deepEqual(detail.questions.map((q) => q.id), ["__proto__", "constructor"]);
    const res = await fetch(t.url(`/api/batches/${id}/answers`), {
      method: "POST",
      headers: { ...t.auth(), "content-type": "application/json" },
      body: `{"answers":[{"questionId":"__proto__","selected":["x"]},{"questionId":"constructor","text":"hi"}]}`,
    });
    const body = (await res.json()) as { batchStatus: string; results: Array<{ status: string }> };
    assert.deepEqual(body.results.map((r) => r.status), ["ok", "ok"]);
    assert.equal(body.batchStatus, "submitted");
  } finally {
    await t.close();
  }
});

test("the chat and cancel routes need the initData lock like every other route", async () => {
  const t = await rig();
  try {
    const id = createBatch(t.store, THREE_QUESTIONS);
    await startBatch(t.store, t.port, id);
    for (const action of ["chat", "cancel"]) {
      const res = await fetch(t.url(`/api/batches/${id}/${action}`), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: true }) });
      assert.equal(res.status, 401, action);
      assert.equal(await res.text(), "");
      const wrongUser = await fetch(t.url(`/api/batches/${id}/${action}`), { method: "POST", headers: { ...t.auth(43), "content-type": "application/json" }, body: JSON.stringify({ confirm: true }) });
      assert.equal(wrongUser.status, 401, action);
    }
    assert.equal(t.port.sends.length, 1);
    assert.equal(t.store.getBatch(id)!.status, "pending");
    assert.equal((await fetch(t.url(`/api/batches/${id}/chat`), { headers: t.auth() })).status, 405);
  } finally {
    await t.close();
  }
});

test("POST chat reposts the open question; with a questionId it moves just that one", async () => {
  const t = await rig();
  try {
    const id = createBatch(t.store, THREE_QUESTIONS);
    await startBatch(t.store, t.port, id);
    const post = (action: string, body: unknown) =>
      fetch(t.url(`/api/batches/${id}/${action}`), { method: "POST", headers: { ...t.auth(), "content-type": "application/json" }, body: JSON.stringify(body) });
    const whole = await post("chat", {});
    assert.equal(whole.status, 200);
    assert.deepEqual(await whole.json(), { status: "ok", moved: 1 });
    assert.equal(t.port.sends.length, 2);
    assert.equal(t.port.sends[1]!.replyTo, t.port.sends[0]!.messageId);

    const one = await post("chat", { questionId: "q3" });
    assert.deepEqual(await one.json(), { status: "ok", moved: 1 });

    const bad = await post("chat", { questionId: 5 });
    assert.equal(bad.status, 400);
    const unknown = await post("chat", { questionId: "zzz" });
    assert.equal(((await unknown.json()) as { status: string }).status, "invalid");
    const missing = await fetch(t.url("/api/batches/ffffffffffffffffffffffff/chat"), { method: "POST", headers: { ...t.auth(), "content-type": "application/json" }, body: "{}" });
    assert.equal(missing.status, 404);
  } finally {
    await t.close();
  }
});

test("POST cancel needs confirm:true, then cancels through cancelBatch and tells the asker", async () => {
  const t = await rig();
  try {
    const id = createBatch(t.store, THREE_QUESTIONS);
    await startBatch(t.store, t.port, id);
    const post = (body: unknown) =>
      fetch(t.url(`/api/batches/${id}/cancel`), { method: "POST", headers: { ...t.auth(), "content-type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await post({})).status, 400);
    assert.equal((await post({ confirm: "yes" })).status, 400);
    assert.equal(t.store.getBatch(id)!.status, "pending");
    assert.equal(t.results.length, 0);

    const ok = await post({ confirm: true });
    assert.deepEqual(await ok.json(), { status: "ok" });
    assert.equal(t.store.getBatch(id)!.status, "cancelled");
    assert.equal(t.results.length, 1);
    assert.equal(t.results[0]!.status, "cancelled");
    assert.ok(t.port.resolvedViews.includes("cancelled:"));

    const again = await post({ confirm: true });
    assert.equal(((await again.json()) as { status: string }).status, "conflict");
    assert.equal(t.results.length, 1);
    // A cancelled set can no longer be moved to chat.
    const move = await fetch(t.url(`/api/batches/${id}/chat`), { method: "POST", headers: { ...t.auth(), "content-type": "application/json" }, body: "{}" });
    assert.equal(((await move.json()) as { status: string }).status, "conflict");
  } finally {
    await t.close();
  }
});
