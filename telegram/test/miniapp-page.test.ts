// The Mini App page's own logic, run against a tiny fake DOM and a stubbed API: back control,
// keyboard dismissal, and what happens after a submit.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPage } from "./support/fake-dom.ts";
import type { PageRig, Route } from "./support/fake-dom.ts";

const LIST = {
  readAt: "2026-10-14T23:00:00Z",
  batches: [{ id: "b1", title: "Pick a plan", asker: "ship:x", createdAt: "2026-10-14T22:00:00Z", timeoutAt: null, total: 2, done: 0 }],
};

function detail(extra: Record<string, unknown> = {}) {
  return {
    ...LIST.batches[0],
    readAt: "2026-10-14T23:00:00Z",
    questions: [
      { id: "q1", prompt: "Which database?", type: "single", options: [{ value: "pg", label: "Postgres", recommended: false }, { value: "sq", label: "SQLite", recommended: false }], allowOther: true, skippable: false, state: "open", preselected: [] },
      { id: "q2", prompt: "Anything else?", type: "text", options: [], allowOther: false, skippable: true, state: "open", preselected: [] },
    ],
    ...extra,
  };
}

function rig(nativeBack: boolean, answers: Route | ((body?: string) => Route)): PageRig {
  return loadPage({
    nativeBack,
    routes: {
      "GET batches": { body: LIST },
      "GET batches/b1": { body: detail() },
      "POST batches/b1/answers": answers,
    },
  });
}

async function openSet(t: PageRig): Promise<void> {
  await t.flush();
  const card = t.doc.root.find((n) => n.tagName === "BUTTON" && n.className === "card")[0]!;
  t.doc.fire(card, "click");
  await t.flush();
}

function chooseAndType(t: PageRig): void {
  const radio = t.doc.root.find((n) => n.tagName === "INPUT" && n.attrs.type === "radio")[0]!;
  t.doc.fire(radio, "change");
  const area = t.doc.root.find((n) => n.tagName === "TEXTAREA")[0]!;
  area.value = "hello";
  t.doc.fire(area, "input");
}

const OK_BOTH: Route = { body: { batchStatus: "submitted", results: [{ questionId: "q1", status: "ok" }, { questionId: "q2", status: "ok" }] } };

test("with Telegram's native back button the page shows no back button of its own", async () => {
  const t = rig(true, OK_BOTH);
  await t.flush();
  assert.ok(t.calls.includes("back.onClick"));
  assert.ok(t.calls.at(-1) === "back.hide", "hidden on the list");
  await openSet(t);
  assert.equal(t.buttons("‹ Back").length, 0);
  assert.equal(t.calls.at(-1), "back.show");
  assert.match(t.texts(), /Which database\?/);
  // The native button goes back to the list and hides itself.
  t.backClick();
  await t.flush();
  assert.match(t.texts(), /Open questions/);
  assert.equal(t.calls.at(-1), "back.hide");
});

test("without the native back button (Bot API older than 6.1) the page keeps its own", async () => {
  const t = rig(false, OK_BOTH);
  await openSet(t);
  assert.ok(!t.calls.includes("back.onClick"));
  assert.ok(!t.calls.includes("back.show"));
  const back = t.buttons("‹ Back");
  assert.equal(back.length, 1);
  t.doc.fire(back[0]!, "click");
  await t.flush();
  assert.match(t.texts(), /Open questions/);
});

test("single-line fields use a Done return key that dismisses the keyboard; the text area keeps Return for new lines", async () => {
  const t = rig(true, OK_BOTH);
  await openSet(t);
  const input = t.doc.root.find((n) => n.tagName === "INPUT" && n.attrs.type === "text")[0]!;
  assert.equal(input.attrs.enterkeyhint, "done");
  input.focus();
  assert.equal(t.doc.body.className, "typing");
  const enter = t.doc.fire(input, "keydown", { key: "Enter" });
  assert.equal(enter.defaultPrevented, true);
  assert.equal(t.doc.activeElement, null);
  assert.equal(t.doc.body.className, "");

  const area = t.doc.root.find((n) => n.tagName === "TEXTAREA")[0]!;
  assert.equal(area.attrs.enterkeyhint, undefined);
  area.focus();
  const returnKey = t.doc.fire(area, "keydown", { key: "Enter" });
  assert.equal(returnKey.defaultPrevented, false);
  assert.equal(t.doc.activeElement, area);
});

test("a Done button sits with every field, a tap elsewhere or a drag dismisses the keyboard, and typing ignores a scroll caused by focus", async () => {
  const t = rig(true, OK_BOTH);
  await openSet(t);
  const fields = t.doc.root.find((n) => n.className === "field");
  assert.equal(fields.length, 2);
  for (const f of fields) assert.equal(f.find((n) => n.tagName === "BUTTON" && n.textContent === "Done").length, 1);

  const area = t.doc.root.find((n) => n.tagName === "TEXTAREA")[0]!;
  area.focus();
  const done = fields[1]!.find((n) => n.textContent === "Done")[0]!;
  t.doc.fire(done, "click");
  assert.equal(t.doc.activeElement, null);

  area.focus();
  const heading = t.doc.root.find((n) => n.tagName === "H1")[0]!;
  t.doc.fire(heading, "pointerdown");
  assert.equal(t.doc.activeElement, null);

  area.focus();
  t.doc.fire(heading, "touchmove"); // right after focus: the browser's own scroll, ignored
  assert.equal(t.doc.activeElement, area);
  area.blur();
});

test("after a fully successful submit the page goes straight to the list with a toast and a success tap", async () => {
  const t = rig(true, OK_BOTH);
  t.fetches.length = 0;
  await openSet(t);
  chooseAndType(t);
  const send = t.doc.getElementById("send")!;
  assert.equal(send.textContent, "Send 2 answers");
  t.doc.fire(send, "click");
  await t.flush();
  const post = t.fetches.find((f) => f.method === "POST")!;
  assert.deepEqual(JSON.parse(post.body!).answers.map((a: { questionId: string }) => a.questionId), ["q1", "q2"]);
  assert.match(t.texts(), /Open questions/);
  assert.match(t.texts(), /Sent 2 answers/);
  assert.doesNotMatch(t.texts(), /go back|Back to open questions|All answered/i);
  assert.ok(t.calls.includes("haptic.success"));
  assert.equal(t.calls.at(-1), "back.hide");
});

test("a submit where some answers fail stays on the set, shows each reason, and says how many went through", async () => {
  const mixed: Route = {
    body: {
      batchStatus: "pending",
      results: [{ questionId: "q1", status: "conflict", reason: "Already answered in chat. Your answer was not used." }, { questionId: "q2", status: "ok" }],
    },
  };
  const t = loadPage({
    nativeBack: true,
    routes: {
      "GET batches": { body: LIST },
      "GET batches/b1": { body: detail() },
      "POST batches/b1/answers": mixed,
    },
  });
  await openSet(t);
  chooseAndType(t);
  t.doc.fire(t.doc.getElementById("send")!, "click");
  await t.flush();
  assert.match(t.texts(), /Which database\?/, "still on the set");
  assert.match(t.texts(), /Already answered in chat/);
  assert.match(t.texts(), /Sent 1 answer\. 1 not sent: Already answered in chat/);
  assert.ok(t.calls.includes("haptic.warning"));
  assert.ok(!t.calls.includes("haptic.success"));
});

test("a mixed submit on a set that has since closed returns to the list and explains in the toast", async () => {
  // The detail route answers 200 when the set is opened and 404 afterwards.
  let reads = 0;
  const cancelled = { reason: "This set was cancelled." };
  const t = loadPage({
    nativeBack: true,
    routes: {
      "GET batches": { body: LIST },
      "GET batches/b1": () => (++reads === 1 ? { body: detail() } : { status: 404, body: { error: "not_found" } }),
      "POST batches/b1/answers": {
        body: { batchStatus: "cancelled", results: [{ questionId: "q1", status: "conflict", ...cancelled }, { questionId: "q2", status: "conflict", ...cancelled }] },
      },
    },
  });
  await openSet(t);
  chooseAndType(t);
  t.doc.fire(t.doc.getElementById("send")!, "click");
  await t.flush();
  assert.match(t.texts(), /Open questions/);
  assert.match(t.texts(), /2 not sent: This set was cancelled\./);
});

test("the list has no Refresh button and reloads by itself when the app comes back into view", async () => {
  const t = rig(true, OK_BOTH);
  await t.flush();
  assert.equal(t.buttons("Refresh").length, 0);
  const lists = () => t.fetches.filter((f) => f.path === "batches").length;
  const before = lists();
  t.tgEvent("activated");
  await t.flush();
  assert.equal(lists(), before + 1);
  t.doc.hidden = false;
  t.doc.fire(t.doc.body, "visibilitychange");
  await t.flush();
  assert.equal(lists(), before + 2);
  // On the set screen a return to the app must not reload the list underneath it.
  await openSet(t);
  const atSet = lists();
  t.tgEvent("activated");
  await t.flush();
  assert.equal(lists(), atSet);
});
