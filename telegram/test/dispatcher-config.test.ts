import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseDispatcherConfig, readDispatcherConfig, activeDispatcher, parseDuration } from "../src/dispatcher/config.ts";

const base = { version: 1, targets: [{ name: "inbox", description: "append to a file", argv: ["cat"] }], defaultTarget: "inbox" };

test("defaults fill in everything but the targets", () => {
  const c = parseDispatcherConfig(base);
  assert.equal(c.enabled, true);
  assert.equal(c.channel, "dispatcher");
  assert.equal(c.model, "sonnet");
  assert.equal(c.waitTimeoutSeconds, 3600);
  assert.equal(c.liveReplyTtlSeconds, 900);
  assert.equal(c.downNoticeAfterSeconds, 120);
  assert.deepEqual(c.session.allowedTools, ["Bash(tg:*)"]);
  assert.equal(c.inboxCommands, false);
  assert.equal(c.session.claudeBin, "claude");
  assert.equal(parseDispatcherConfig({ ...base, session: { claudeBin: "~/.local/bin/claude" } }).session.claudeBin, "~/.local/bin/claude");
  assert.throws(() => parseDispatcherConfig({ ...base, session: { claudeBin: "claude; rm -rf" } }), /claudeBin/);
  assert.equal(c.targets[0]!.ack, "Sent to {{name}}.");
});

test("durations parse and bad ones are rejected", () => {
  assert.equal(parseDuration("2m", 0, "x"), 120);
  assert.equal(parseDuration(undefined, 7, "x"), 7);
  assert.throws(() => parseDuration("soon", 0, "x"), /not a duration/);
});

test("invalid shapes are rejected with a reason", () => {
  assert.throws(() => parseDispatcherConfig({ ...base, version: 2 }), /version/);
  assert.throws(() => parseDispatcherConfig({ ...base, defaultTarget: "nope" }), /defaultTarget/);
  assert.throws(() => parseDispatcherConfig({ ...base, targets: [{ name: "a", description: "d" }] }), /exactly one/);
  assert.throws(() => parseDispatcherConfig({ ...base, targets: [{ name: "a", description: "d", argv: ["x"], builtin: "claude-session" }] }), /exactly one/);
  assert.throws(() => parseDispatcherConfig({ ...base, targets: [{ name: "a", description: "d", builtin: "claude-session" }] }), /allowedCwds/);
  assert.throws(() => parseDispatcherConfig({ ...base, targets: [base.targets[0], base.targets[0]] }), /duplicate/);
  assert.throws(() => parseDispatcherConfig({ ...base, model: "x; rm -rf" }), /model/);
  assert.throws(() => parseDispatcherConfig({ ...base, channel: "bad name" }), /channel/);
});

test("missing file is absent, a bad file is invalid with a reason, a good one is ok; enabled false is inactive", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tg-dispcfg-"));
  try {
    const file = path.join(dir, "dispatcher.json");
    assert.equal(readDispatcherConfig(file).state, "absent");
    assert.equal(activeDispatcher(file), undefined);
    writeFileSync(file, "{ not json");
    const bad = readDispatcherConfig(file);
    assert.equal(bad.state, "invalid");
    assert.equal(activeDispatcher(file), undefined);
    writeFileSync(file, JSON.stringify(base));
    assert.equal(readDispatcherConfig(file).state, "ok");
    assert.ok(activeDispatcher(file));
    writeFileSync(file, JSON.stringify({ ...base, enabled: false, pad: "xx" }));
    assert.equal(activeDispatcher(file), undefined, "a changed file is re-read");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
