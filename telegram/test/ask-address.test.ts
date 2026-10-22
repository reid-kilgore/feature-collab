// `tg ask` shows who is asking by the same address as tg send: --from, then AGENT_TELEGRAM_FROM, then
// the real tmux (session:window). It is the last line of the header and the end of the footer. The
// ask-questions result keeps its own askerTmuxWindow field exactly as before.

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderHeader, renderBatchDone } from "../src/transports/telegram/render.ts";
import { setupHarness, sleep, waitForSocketAt, daemonSocketPath } from "./support/harness.ts";
import type { Harness } from "./support/harness.ts";

test("the header ends with the asker's address when known, and is unchanged when not", () => {
  const payload = { version: 1, title: "Deploy?", message: "Two options", questions: [] } as never;
  assert.equal(renderHeader(payload, "ship:geo"), "📋 <b>Deploy?</b>\nTwo options\n<i>ship:geo</i>");
  assert.equal(renderHeader(payload), "📋 <b>Deploy?</b>\nTwo options");
  assert.equal(renderHeader({ version: 1, questions: [] } as never, "ship:geo"), undefined, "no header, no address line");
  assert.match(renderHeader(payload, "a<b>")!, /<i>a&lt;b&gt;<\/i>$/);
});

test("the footer names the address in place of the window name", () => {
  assert.equal(renderBatchDone("proj", "geo", "ship:geo"), "✅ Answers sent to the agent (proj, ship:geo)");
  assert.equal(renderBatchDone("proj", "geo"), "✅ Answers sent to the agent (proj, geo)");
  assert.equal(renderBatchDone("proj"), "✅ Answers sent to the agent (proj)");
});

async function waitFor(pred: () => boolean): Promise<void> {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && !pred()) await sleep(30);
  if (!pred()) throw new Error("condition not met in time");
}

async function runAsk(h: Harness, extraArgs: string[] = []): Promise<{ texts: string[]; result: any }> {
  const payload = {
    version: 1,
    title: "Pick",
    message: "Choose one",
    questions: [{ id: "c", prompt: "Colour?", type: "single", options: [{ value: "red", label: "Red" }] }],
  };
  const proc = h.spawnCli(["ask", ...extraArgs, "--json", JSON.stringify(payload)]);
  let out = "";
  proc.stdout!.on("data", (c) => (out += c.toString()));
  const q = () => h.fake.sent.find((m) => m.method === "sendMessage" && /q:[a-z0-9]{10}:s:0/.test(JSON.stringify(m.body.reply_markup ?? {})));
  await waitFor(() => Boolean(q()));
  const shortId = /q:([a-z0-9]{10}):s:0/.exec(JSON.stringify(q()!.body.reply_markup))![1];
  h.fake.pushCallback({ chatId: Number(h.chatId), userId: Number(h.userId), data: `q:${shortId}:s:0` });
  await new Promise((r) => proc.once("close", r));
  await waitFor(() => h.fake.sent.some((m) => String(m.body.text ?? "").startsWith("✅ Answers sent")));
  return {
    texts: h.fake.sent.filter((m) => m.method === "sendMessage").map((m) => String(m.body.text ?? "")),
    result: JSON.parse(out.trim().split("\n").pop()!),
  };
}

test("tg ask --from puts the address in the header and the footer, and the result keeps askerTmuxWindow as before", async () => {
  const h = await setupHarness();
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    const { texts, result } = await runAsk(h, ["--from", "ship:geo"]);
    assert.ok(texts.some((t) => t === "📋 <b>Pick</b>\nChoose one\n<i>ship:geo</i>"), JSON.stringify(texts));
    assert.ok(texts.some((t) => /^✅ Answers sent to the agent \(.*, ship:geo\)$/.test(t)), JSON.stringify(texts));
    assert.equal(result.askerTmuxWindow, undefined, "the contract field is untouched; it is only a window name");
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("tg ask uses AGENT_TELEGRAM_FROM, and --from wins over it", async () => {
  const h = await setupHarness();
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    h.env.AGENT_TELEGRAM_FROM = "review:env";
    const first = await runAsk(h);
    assert.ok(first.texts.some((t) => t.endsWith("<i>review:env</i>")));
    h.fake.sent.length = 0;
    const second = await runAsk(h, ["--from", "ship:flag"]);
    assert.ok(second.texts.some((t) => t.endsWith("<i>ship:flag</i>")));
    assert.ok(!second.texts.some((t) => t.includes("review:env")));
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("tg ask with no address anywhere is unchanged", async () => {
  const h = await setupHarness();
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    const { texts } = await runAsk(h);
    assert.ok(texts.some((t) => t === "📋 <b>Pick</b>\nChoose one"));
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});
