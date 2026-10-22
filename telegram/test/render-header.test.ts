// No emoji-and-hostname header on every message (Reid, 2026-10-22). Info and success messages start with
// their content. Warning and error keep one level emoji at the start of the first line. Who sent it is
// shown as a small italic last line, when it is known. The host is not shown: it is always the machine
// the bot runs on, so it says nothing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderNotification, renderHeader } from "../src/transports/telegram/render.ts";
import { setupHarness, sleep, waitForSocketAt, daemonSocketPath } from "./support/harness.ts";

test("info and success start with their content, no header line", () => {
  assert.equal(renderNotification("info", undefined, "plain body"), "plain body");
  assert.equal(renderNotification("success", "Done", "All good"), "<b>Done</b>\nAll good");
});

test("warning and error put one emoji at the start of the first line", () => {
  assert.equal(renderNotification("warning", undefined, "disk is 90% full"), "⚠️ disk is 90% full");
  assert.equal(renderNotification("error", "Build broke", "3 type errors"), "❌ <b>Build broke</b>\n3 type errors");
});

test("the sender is a small italic last line, escaped, and only when given", () => {
  assert.equal(renderNotification("info", "Done", "ok", "rk-1021-ack-c2"), "<b>Done</b>\nok\n<i>rk-1021-ack-c2</i>");
  assert.equal(renderNotification("info", undefined, "ok", "a<b>"), "ok\n<i>a&lt;b&gt;</i>");
  assert.doesNotMatch(renderNotification("info", undefined, "ok"), /<i>/);
});

test("no rendered message carries the host marker", () => {
  for (const level of ["info", "success", "warning", "error"] as const) {
    assert.doesNotMatch(renderNotification(level, "t", "b", "s"), /🖥/);
  }
});

test("the ask header has no host line", () => {
  const text = renderHeader({ version: 1, title: "Deploy?", message: "Two options", questions: [] } as never)!;
  assert.doesNotMatch(text, /🖥/);
  assert.equal(text, "📋 <b>Deploy?</b>\nTwo options");
  assert.equal(renderHeader({ version: 1, questions: [] } as never), undefined);
});

async function sentText(h: Awaited<ReturnType<typeof setupHarness>>): Promise<string> {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && !h.fake.sent.some((m) => m.method === "sendMessage")) await sleep(30);
  return String(h.fake.sent.find((m) => m.method === "sendMessage")!.body.text);
}

test("tg send with a title and an explicit channel ends with the channel as the sender; a bare tg send has no sender line", async () => {
  const h = await setupHarness({ hostname: "REDD-mason" });
  try {
    delete h.env.TMUX;
    delete h.env.TMUX_PANE;
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    await h.runCli(["send", "--title", "Done", "--channel", "review-bot", "All good"]);
    assert.equal(await sentText(h), "<b>Done</b>\nAll good\n<i>review-bot</i>");
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("a bare tg send is just the text", async () => {
  const h = await setupHarness({ hostname: "REDD-mason" });
  try {
    delete h.env.TMUX;
    delete h.env.TMUX_PANE;
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    await h.runCli(["send", "Build finished"]);
    assert.equal(await sentText(h), "Build finished");
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("a path channel is shown by its last directory name, and a pane id is never shown", async () => {
  const h = await setupHarness();
  try {
    delete h.env.TMUX;
    delete h.env.TMUX_PANE;
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    await h.runCli(["send", "--title", "T", "--channel", "/Users/reid/dev/passcom/rk-0916-birch-refund", "x"]);
    assert.equal(await sentText(h), "<b>T</b>\nx\n<i>rk-0916-birch-refund</i>");
    h.fake.sent.length = 0;
    await h.runCli(["send", "--title", "T", "--channel", "%49", "y"]);
    assert.equal(await sentText(h), "<b>T</b>\ny");
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

// ---- the sender line shows the tmux address (session:window) ----

import { writeFileSync, chmodSync, readFileSync } from "node:fs";
import path from "node:path";

function tmuxStub(h: Awaited<ReturnType<typeof setupHarness>>, answer: string): string {
  const stub = path.join(h.home, "tmux-stub.cjs");
  writeFileSync(
    stub,
    `#!/usr/bin/env node\nrequire("node:fs").appendFileSync(require("node:path").join(__dirname, "tmux.log"), JSON.stringify(process.argv.slice(2)) + "\\n");\nprocess.stdout.write(${JSON.stringify(answer)} + "\\n");\n`,
  );
  chmodSync(stub, 0o755);
  return stub;
}

test("inside tmux, a bare tg send ends with the session:window address, asked of the sender's own pane", async () => {
  const h = await setupHarness();
  try {
    h.env.TMUX = "/tmp/tmux-501/default,1,0";
    h.env.TMUX_PANE = "%5";
    h.env.AGENT_TELEGRAM_TMUX_BIN = tmuxStub(h, "ship:geo");
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    await h.runCli(["send", "Build finished"]);
    assert.equal(await sentText(h), "Build finished\n<i>ship:geo</i>");
    const call = JSON.parse(readFileSync(path.join(h.home, "tmux.log"), "utf8").trim().split("\n")[0]!);
    assert.deepEqual(call, ["display-message", "-p", "-t", "%5", "#S:#W"]);
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("inside tmux the address is shown with a title too, and replaces the channel name", async () => {
  const h = await setupHarness();
  try {
    h.env.TMUX = "/tmp/tmux-501/default,1,0";
    h.env.TMUX_PANE = "%5";
    h.env.AGENT_TELEGRAM_TMUX_BIN = tmuxStub(h, "ship:geo");
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    await h.runCli(["send", "--title", "Done", "--channel", "review-bot", "ok"]);
    assert.equal(await sentText(h), "<b>Done</b>\nok\n<i>ship:geo</i>");
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("a caller outside tmux can pass its address: AGENT_TELEGRAM_FROM, and --from wins over it", async () => {
  const h = await setupHarness();
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    h.env.AGENT_TELEGRAM_FROM = "ship:remote";
    await h.runCli(["send", "from env"]);
    assert.equal(await sentText(h), "from env\n<i>ship:remote</i>");
    h.fake.sent.length = 0;
    await h.runCli(["send", "--from", "review:other", "from flag"]);
    assert.equal(await sentText(h), "from flag\n<i>review:other</i>");
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("a passed address is cleaned: control characters dropped, length capped, and the text is escaped", async () => {
  const h = await setupHarness();
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    await h.runCli(["send", "--from", `a<b>\u0007${"x".repeat(200)}`, "hi"]);
    const text = await sentText(h);
    const sender = /<i>(.*)<\/i>$/.exec(text)![1]!;
    assert.ok(sender.startsWith("a&lt;b&gt;x"));
    assert.ok(!/\u0007/.test(text));
    assert.ok(sender.length <= 80 + "&lt;&gt;".length * 2);
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("a tmux that fails to answer leaves the old rule: bare text, no sender", async () => {
  const h = await setupHarness();
  try {
    h.env.TMUX = "/tmp/tmux-501/default,1,0";
    h.env.TMUX_PANE = "%5";
    const stub = path.join(h.home, "tmux-fail.cjs");
    writeFileSync(stub, "#!/usr/bin/env node\nprocess.exit(1);\n");
    chmodSync(stub, 0o755);
    h.env.AGENT_TELEGRAM_TMUX_BIN = stub;
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    await h.runCli(["send", "just text"]);
    assert.equal(await sentText(h), "just text");
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});
