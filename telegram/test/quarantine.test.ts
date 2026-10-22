// Unrouted (channel NULL) unread messages are visible to every `tg recv` caller, so a stale one
// reaches whichever session listens next. `tg quarantine` moves them into the inquiry log as
// state "legacy" and marks them consumed. --dry-run changes nothing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readInquiries } from "../src/core/inquiry-log.ts";
import { setupHarness, sleep, waitForSocketAt, daemonSocketPath } from "./support/harness.ts";

async function pushTwo(h: Awaited<ReturnType<typeof setupHarness>>): Promise<void> {
  for (const text of ["old message one", "old message two"]) {
    h.fake.pushMessage({ chatId: Number(h.chatId), userId: Number(h.userId), text });
  }
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && h.fake.sent.filter((m) => m.method === "setMessageReaction").length < 2) await sleep(30);
}

test("quarantine --dry-run reports the rows and changes nothing", async () => {
  const h = await setupHarness();
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    await pushTwo(h);
    const out = await h.runCli(["quarantine", "--dry-run"]);
    assert.equal(out.code, 0, out.stderr);
    assert.match(out.stdout, /2 unrouted unread/);
    const logLines = readFileSync(path.join(h.home, "state", "inquiries.jsonl"), "utf8").trim().split("\n");
    assert.equal(logLines.length, 2, "dry run adds nothing to the log beyond the two receipt lines");
    const peek = await h.runCli(["recv", "--peek"]);
    assert.equal(JSON.parse(peek.stdout.trim()).messages.length, 2);
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("quarantine logs each unrouted unread message as legacy and consumes it", async () => {
  const h = await setupHarness();
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    await pushTwo(h);
    const out = await h.runCli(["quarantine"]);
    assert.equal(out.code, 0, out.stderr);
    assert.match(out.stdout, /quarantined 2/);

    const inquiries = readInquiries(path.join(h.home, "state", "inquiries.jsonl"));
    assert.equal(inquiries.length, 2);
    assert.deepEqual(inquiries.map((i) => i.text).sort(), ["old message one", "old message two"]);
    for (const i of inquiries) assert.equal(i.state, "legacy");
    const after = await h.runCli(["recv"]);
    assert.equal(JSON.parse(after.stdout.trim()).messages.length, 0, "no session receives the old text");

    const again = await h.runCli(["quarantine"]);
    assert.match(again.stdout, /quarantined 0/, "idempotent");
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("quarantine leaves messages bound to a channel alone", async () => {
  const h = await setupHarness();
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    await h.runCli(["send", "--channel", "sessionA", "hello"]);
    h.fake.pushMessage({ chatId: Number(h.chatId), userId: Number(h.userId), text: "for session A" });
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline && !h.fake.sent.some((m) => m.method === "setMessageReaction")) await sleep(30);
    const out = await h.runCli(["quarantine"]);
    assert.match(out.stdout, /quarantined 0/);
    const peek = await h.runCli(["recv", "--peek", "--channel", "sessionA"]);
    assert.equal(JSON.parse(peek.stdout.trim()).messages.length, 1);
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("quarantine logs rows that predate the log as legacy received lines", async () => {
  const h = await setupHarness();
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    await pushTwo(h);
    rmSync(path.join(h.home, "state", "inquiries.jsonl")); // as if the rows came from an older build
    const out = await h.runCli(["quarantine"]);
    assert.match(out.stdout, /quarantined 2/);
    const lines = readFileSync(path.join(h.home, "state", "inquiries.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(lines.length, 2);
    for (const l of lines) {
      assert.equal(l.op, "received");
      assert.equal(l.state, "legacy");
    }
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

// ---- stale channels ----
// Unread messages bound to a channel nobody is listening on are as stale as unrouted ones: a new
// session that gets a reused tmux pane id would receive them. `--stale-channels` moves them too.

async function strandOnChannels(h: Awaited<ReturnType<typeof setupHarness>>): Promise<void> {
  const base = h.fake.sent.filter((m) => m.method === "setMessageReaction").length;
  for (const [channel, text] of [["%44", "for pane 44"], ["%46", "for pane 46"]] as const) {
    await h.runCli(["send", "--channel", channel, `hello from ${channel}`]);
    const sentId = h.fake.sent.filter((m) => m.method === "sendMessage").length;
    h.fake.pushMessage({ chatId: Number(h.chatId), userId: Number(h.userId), text, replyToMessageId: sentId });
    const want = base + (channel === "%44" ? 1 : 2);
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline && h.fake.sent.filter((m) => m.method === "setMessageReaction").length < want) await sleep(30);
  }
}

test("quarantine --stale-channels --dry-run lists the rows by channel and changes nothing", async () => {
  const h = await setupHarness();
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    await strandOnChannels(h);
    const out = await h.runCli(["quarantine", "--stale-channels", "--older", "0s", "--dry-run"]);
    assert.equal(out.code, 0, out.stderr);
    assert.match(out.stdout, /dry run: 2 unread message\(s\) on stale channels would be quarantined/);
    assert.match(out.stdout, /%44\s+1/);
    assert.match(out.stdout, /%46\s+1/);
    assert.equal(JSON.parse((await h.runCli(["recv", "--peek", "--channel", "%44"])).stdout.trim()).messages.length, 1);
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("quarantine --stale-channels moves old channel-bound rows into the log as legacy and consumes them", async () => {
  const h = await setupHarness();
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    await strandOnChannels(h);
    const out = await h.runCli(["quarantine", "--stale-channels", "--older", "0s"]);
    assert.match(out.stdout, /quarantined 2/);
    const inquiries = readInquiries(path.join(h.home, "state", "inquiries.jsonl"));
    assert.deepEqual(inquiries.map((i) => [i.text, i.state]).sort(), [["for pane 44", "legacy"], ["for pane 46", "legacy"]]);
    for (const channel of ["%44", "%46"]) {
      assert.equal(JSON.parse((await h.runCli(["recv", "--channel", channel])).stdout.trim()).messages.length, 0);
    }
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("quarantine --stale-channels leaves recent rows alone (default threshold is a day)", async () => {
  const h = await setupHarness();
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    await strandOnChannels(h);
    const out = await h.runCli(["quarantine", "--stale-channels", "--dry-run"]);
    assert.match(out.stdout, /dry run: 0 unread message\(s\) on stale channels/);
    const withOlder = await h.runCli(["quarantine", "--stale-channels", "--older", "2h", "--dry-run"]);
    assert.match(withOlder.stdout, /dry run: 0 unread/);
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("quarantine --stale-channels never touches the dispatcher channel", async () => {
  const h = await setupHarness();
  try {
    const daemon = h.spawnCli(["daemon"]);
    await waitForSocketAt(daemonSocketPath(h.home));
    await strandOnChannels(h); // before the dispatcher exists: replies to a stale channel are bound to it
    writeFileSync(
      path.join(h.home, "config", "dispatcher.json"),
      JSON.stringify({ version: 1, channel: "dispatcher", targets: [{ name: "t", description: "d", argv: ["true"] }], defaultTarget: "t" }),
    );
    h.fake.pushMessage({ chatId: Number(h.chatId), userId: Number(h.userId), text: "queued for the dispatcher" });
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline && h.fake.sent.filter((m) => m.method === "setMessageReaction").length < 3) await sleep(30);
    const out = await h.runCli(["quarantine", "--stale-channels", "--older", "0s", "--dry-run"]);
    assert.match(out.stdout, /dry run: 2 unread/);
    assert.doesNotMatch(out.stdout, /dispatcher\s+\d/);
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("quarantine rejects --older without --stale-channels, and a bad duration", async () => {
  const h = await setupHarness();
  try {
    assert.equal((await h.runCli(["quarantine", "--older", "1h"])).code, 1);
    const bad = await h.runCli(["quarantine", "--stale-channels", "--older", "soon"]);
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /Invalid duration/);
  } finally {
    await h.teardown();
  }
});
