// The dispatcher (DESIGN-dispatcher.md): routing of bare messages, the wait command, the down
// notice, `tg dispatch`, the inquiry log and its commands. Real daemon, real socket, fake Telegram.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import path from "node:path";
import { parseDispatcherConfig } from "../src/dispatcher/config.ts";
import { setupHarness, sleep, waitForSocketAt, daemonSocketPath } from "./support/harness.ts";
import type { Harness } from "./support/harness.ts";

async function waitUntil(predicate: () => boolean | Promise<boolean>, timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(30);
  }
  throw new Error("condition not met in time");
}

// A target that records what reached its stdin and prints a reference, or fails on demand.
function writeTarget(h: Harness): string {
  const file = path.join(h.home, "target.cjs");
  writeFileSync(
    file,
    `const fs = require("node:fs");
const path = require("node:path");
const input = fs.readFileSync(0, "utf8");
fs.appendFileSync(path.join(__dirname, "target-in.jsonl"), JSON.stringify({ input, argv: process.argv.slice(2) }) + "\\n");
if (fs.existsSync(path.join(__dirname, "target-fail"))) { process.stderr.write("target is down\\n"); process.exit(3); }
process.stdout.write("ref-" + fs.readFileSync(path.join(__dirname, "target-in.jsonl"), "utf8").split("\\n").filter(Boolean).length + "  extra words\\n");
`,
  );
  return file;
}

function targetCalls(h: Harness): Array<{ input: string; argv: string[] }> {
  const file = path.join(h.home, "target-in.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function writeConfig(h: Harness, extra: Record<string, unknown> = {}): void {
  const target = writeTarget(h);
  writeFileSync(
    path.join(h.home, "config", "dispatcher.json"),
    JSON.stringify({
      version: 1,
      channel: "dispatcher",
      liveReplyTtl: "1s",
      downNoticeAfter: "1s",
      defaultTarget: "inbox",
      targets: [
        { name: "inbox", description: "append to the inbox", argv: [process.execPath, target, "{{tag}}"], ack: "Filed as {{stdout1}}", nudge: { to: "boss", template: "New item {{ref}}: {{text}}" } },
        { name: "plain", description: "no params", argv: [process.execPath, target], ack: "Sent to {{name}}" },
      ],
      ...extra,
    }),
  );
}

async function start(h: Harness) {
  const daemon = h.spawnCli(["daemon"]);
  await waitForSocketAt(daemonSocketPath(h.home));
  return daemon;
}

function say(h: Harness, text: string, reply?: { id: number; text?: string }): number {
  return h.fake.pushMessage({ chatId: Number(h.chatId), userId: Number(h.userId), text, ...(reply ? { replyToMessageId: reply.id, replyToText: reply.text } : {}) });
}

function inquiryLines(h: Harness): Array<Record<string, any>> {
  const file = path.join(h.home, "state", "inquiries.jsonl");
  return existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
}

function reactions(h: Harness): string[] {
  return h.fake.sent.filter((m) => m.method === "setMessageReaction").map((m) => (m.body.reaction as Array<{ emoji: string }>)[0]!.emoji);
}

function spawnWait(h: Harness) {
  const proc = h.spawnCli(["dispatcher", "wait"]);
  let out = "";
  let err = "";
  proc.stdout!.on("data", (c) => (out += c.toString()));
  proc.stderr!.on("data", (c) => (err += c.toString()));
  const closed = new Promise<number | null>((resolve) => proc.once("close", resolve));
  return { proc, closed, out: () => out, err: () => err };
}

async function untilListening(h: Harness): Promise<void> {
  await waitUntil(async () => /dispatcher: on.*, listening/.test((await h.runCli(["status"])).stdout));
}

test("with a dispatcher, a bare message goes to the dispatcher channel, is logged, and gets the queued reaction", async () => {
  const h = await setupHarness();
  try {
    writeConfig(h);
    const daemon = await start(h);
    const id = say(h, "please look at the payroll bug");
    await waitUntil(() => reactions(h).length > 0);
    assert.deepEqual(reactions(h), ["✍"]);
    assert.equal(h.fake.sent.filter((m) => m.method === "sendMessage" && String(m.body.text ?? "").startsWith("Added ")).length, 0);

    const lines = inquiryLines(h);
    assert.equal(lines.length, 1);
    assert.equal(lines[0]!.op, "received");
    assert.equal(lines[0]!.text, "please look at the payroll bug");
    assert.equal(lines[0]!.routedTo, "dispatcher");
    assert.equal(lines[0]!.tgMessageId, id);

    const status = await h.runCli(["status"]);
    assert.match(status.stdout, /dispatcher: on, channel dispatcher, NOT listening, 1 queued/);
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("tg dispatcher wait delivers the message with the protocol, and the reaction is 👀", async () => {
  const h = await setupHarness();
  try {
    writeConfig(h);
    const daemon = await start(h);
    const w = spawnWait(h);
    await untilListening(h);
    const id = say(h, "hello dispatcher");
    assert.equal(await w.closed, 0, w.err());
    const out = JSON.parse(w.out().trim());
    assert.equal(out.status, "received");
    assert.equal(out.messages[0].text, "hello dispatcher");
    assert.equal(out.messages[0].tgMessageId, id);
    assert.ok(Array.isArray(out.protocol) && out.protocol.join(" ").includes("tg dispatcher wait"));
    assert.equal(out.rearm, "tg dispatcher wait");
    assert.deepEqual(reactions(h), ["👀"]);
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("a second dispatcher listener is refused", async () => {
  const h = await setupHarness();
  try {
    writeConfig(h);
    const daemon = await start(h);
    const first = spawnWait(h);
    await untilListening(h);
    const second = spawnWait(h);
    assert.equal(await second.closed, 1);
    assert.match(second.err(), /already has a listener/);
    first.proc.kill("SIGKILL");
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("a reply to a live channel goes to that channel, a reply to a stale one goes to the dispatcher with its name and quote", async () => {
  const h = await setupHarness();
  try {
    writeConfig(h);
    const daemon = await start(h);
    await h.runCli(["send", "--channel", "sessionA", "Shall I proceed with the migration?"]);
    await h.runCli(["send", "--channel", "sessionB", "Tests are green."]);
    const idA = h.fake.sent.filter((m) => m.method === "sendMessage")[0]!.messageId!;
    const idB = h.fake.sent.filter((m) => m.method === "sendMessage")[1]!.messageId!;

    // sessionA is listening now (live); sessionB never listened (stale).
    const a = h.spawnCli(["recv", "--wait", "--timeout", "20s", "--channel", "sessionA"]);
    let aOut = "";
    a.stdout!.on("data", (c) => (aOut += c.toString()));
    await waitUntil(async () => /channel|listening/.test((await h.runCli(["status"])).stdout) && /sessionA .*listening=true/.test((await h.runCli(["status"])).stdout));

    say(h, "yes proceed", { id: idA, text: "Shall I proceed with the migration?" });
    await new Promise((r) => a.once("close", r));
    assert.equal(JSON.parse(aOut.trim()).messages[0].text, "yes proceed");

    say(h, "thanks", { id: idB, text: "Tests are green." });
    await waitUntil(() => reactions(h).length >= 2);
    const peek = JSON.parse((await h.runCli(["recv", "--peek", "--channel", "dispatcher"])).stdout.trim());
    assert.equal(peek.messages.length, 1);
    assert.equal(peek.messages[0].text, "thanks");
    assert.equal(peek.messages[0].replyTo.channel, "sessionB");
    assert.equal(peek.messages[0].replyTo.quote, "Tests are green.");
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("a channel that stopped listening within the TTL is still live; after the TTL it is stale", async () => {
  const h = await setupHarness();
  try {
    writeConfig(h, { liveReplyTtl: "2s" });
    const daemon = await start(h);
    await h.runCli(["send", "--channel", "sessionA", "question?"]);
    const idA = h.fake.sent.filter((m) => m.method === "sendMessage")[0]!.messageId!;
    // listen briefly, then stop
    await h.runCli(["recv", "--wait", "--timeout", "1s", "--channel", "sessionA"]);
    say(h, "within ttl", { id: idA });
    await waitUntil(() => reactions(h).length >= 1);
    assert.equal(JSON.parse((await h.runCli(["recv", "--peek", "--channel", "sessionA"])).stdout.trim()).messages.length, 1);
    await sleep(2200);
    say(h, "after ttl", { id: idA });
    await waitUntil(() => reactions(h).length >= 2);
    const d = JSON.parse((await h.runCli(["recv", "--peek", "--channel", "dispatcher"])).stdout.trim());
    assert.deepEqual(d.messages.map((m: any) => m.text), ["after ttl"]);
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("a down dispatcher gets one notice per outage, and the notice re-arms after it listens again", async () => {
  const h = await setupHarness();
  try {
    writeConfig(h);
    const daemon = await start(h);
    const notices = () => h.fake.sent.filter((m) => m.method === "sendMessage" && String(m.body.text ?? "").startsWith("Dispatcher is not listening"));
    say(h, "one");
    say(h, "two");
    await waitUntil(() => notices().length === 1);
    assert.match(String(notices()[0]!.body.text), /2 messages are queued/);
    await sleep(1500);
    assert.equal(notices().length, 1, "no second notice in the same outage");

    // dispatcher comes back, drains, then goes away again
    const w = spawnWait(h);
    assert.equal(await w.closed, 0);
    assert.equal(JSON.parse(w.out().trim()).messages.length, 2);
    say(h, "three");
    await waitUntil(() => notices().length === 2);
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("flipping enabled in dispatcher.json takes effect without a restart", async () => {
  const h = await setupHarness();
  try {
    writeConfig(h);
    const daemon = await start(h);
    say(h, "first");
    await waitUntil(() => reactions(h).length >= 1);
    assert.equal(JSON.parse((await h.runCli(["recv", "--peek", "--channel", "dispatcher"])).stdout.trim()).messages.length, 1);

    writeConfig(h, { enabled: false });
    say(h, "second");
    await waitUntil(() => reactions(h).length >= 2);
    // old order: nobody has sent anything, so the message is unrouted and visible to any channel
    const other = JSON.parse((await h.runCli(["recv", "--peek", "--channel", "somebody"])).stdout.trim());
    assert.deepEqual(other.messages.map((m: any) => m.text), ["second"]);
    assert.match((await h.runCli(["status"])).stdout, /dispatcher: disabled/);
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("a malformed dispatcher.json turns the feature off and says why in tg status", async () => {
  const h = await setupHarness();
  try {
    writeFileSync(path.join(h.home, "config", "dispatcher.json"), "{ nope");
    const daemon = await start(h);
    say(h, "hello");
    await waitUntil(() => reactions(h).length >= 1);
    const status = await h.runCli(["status"]);
    assert.match(status.stdout, /dispatcher: OFF \(dispatcher\.json invalid/);
    const w = await h.runCli(["dispatcher", "wait"]);
    assert.equal(w.code, 1);
    assert.match(w.stderr, /dispatcher\.json is invalid/);
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("tg dispatch runs the target with the text on stdin, replies under the message, logs the handoff and prints the nudge", async () => {
  const h = await setupHarness();
  try {
    writeConfig(h);
    const daemon = await start(h);
    const tgId = say(h, "fix the payroll bug; $(touch /tmp/pwned) `id`\nsecond line");
    await waitUntil(() => reactions(h).length >= 1);
    const [{ id }] = inquiryLines(h) as [{ id: string }];

    const r = await h.runCli(["dispatch", "inbox", "--inquiry", id, "--param", "tag=urgent", "--note", "treated as a task"]);
    assert.equal(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout.trim());
    assert.equal(out.status, "handed_off");
    assert.equal(out.ref, "ref-1");
    assert.equal(out.ack, "Filed as ref-1");
    assert.deepEqual(out.nudge, { to: "boss", target: "inbox", message: "New item ref-1: fix the payroll bug; $(touch /tmp/pwned) `id`\nsecond line" });

    // no shell: metacharacters arrive intact on stdin, argv holds only the substituted parameter
    const calls = targetCalls(h);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.input, "fix the payroll bug; $(touch /tmp/pwned) `id`\nsecond line");
    assert.deepEqual(calls[0]!.argv, ["urgent"]);
    assert.ok(!existsSync("/tmp/pwned"));

    // the acknowledgement is a reply under Reid's message, with the note
    const ack = h.fake.sent.find((m) => m.method === "sendMessage" && String(m.body.text ?? "").includes("Filed as ref-1"))!;
    assert.match(String(ack.body.text), /treated as a task/);
    assert.equal((ack.body.reply_parameters as { message_id: number }).message_id, tgId);

    // handed off: logged, and marked with the handed-off reaction
    await waitUntil(() => reactions(h).includes("🫡"));
    const state = inquiryLines(h).find((l) => l.op === "state")!;
    assert.equal(state.state, "handed_off");
    assert.equal(state.target, "inbox");
    assert.equal(state.ref, "ref-1");

    // the same inquiry is not handed off twice
    const again = await h.runCli(["dispatch", "plain", "--inquiry", id]);
    assert.equal(again.code, 1);
    assert.match(again.stderr, /already handed_off/);
    assert.equal(targetCalls(h).length, 1);
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("a failing target is reported to Reid as a warning, exits 1, and leaves the inquiry open", async () => {
  const h = await setupHarness();
  try {
    writeConfig(h);
    writeFileSync(path.join(h.home, "target-fail"), "");
    const daemon = await start(h);
    say(h, "do a thing");
    await waitUntil(() => reactions(h).length >= 1);
    const id = inquiryLines(h)[0]!.id as string;
    const r = await h.runCli(["dispatch", "plain", "--inquiry", id]);
    assert.equal(r.code, 1);
    assert.equal(JSON.parse(r.stdout.trim()).status, "failed");
    const warn = h.fake.sent.find((m) => m.method === "sendMessage" && String(m.body.text ?? "").includes("Could not hand this to plain") && String(m.body.text ?? "").includes("target is down"))!;
    assert.ok(warn, "Reid is told");
    assert.match(String(warn.body.text), /still open/);
    const open = await h.runCli(["inquiries", "list", "--open"]);
    assert.match(open.stdout, new RegExp(id));
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("tg dispatch rejects an unknown target, an unknown inquiry and a missing parameter", async () => {
  const h = await setupHarness();
  try {
    writeConfig(h);
    const daemon = await start(h);
    say(h, "x");
    await waitUntil(() => reactions(h).length >= 1);
    const id = inquiryLines(h)[0]!.id as string;
    assert.match((await h.runCli(["dispatch", "nope", "--inquiry", id])).stderr, /unknown target "nope"/);
    assert.match((await h.runCli(["dispatch", "plain", "--inquiry", "zzz"])).stderr, /unknown inquiry zzz/);
    const missing = await h.runCli(["dispatch", "inbox", "--inquiry", id]);
    assert.equal(missing.code, 1);
    assert.equal(targetCalls(h).length, 0, "nothing ran");
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("a question from the dispatcher is a reply under the message, and Reid's answer arrives carrying the inquiry", async () => {
  const h = await setupHarness();
  try {
    writeConfig(h);
    const daemon = await start(h);
    const tgId = say(h, "do the thing");
    await waitUntil(() => reactions(h).length >= 1);
    const id = inquiryLines(h)[0]!.id as string;
    const asked = await h.runCli(["dispatch", "ask", id, "Which repository?"]);
    assert.equal(asked.code, 0, asked.stderr);
    const q = h.fake.sent.find((m) => m.method === "sendMessage" && String(m.body.text ?? "").includes("Which repository?"))!;
    assert.equal((q.body.reply_parameters as { message_id: number }).message_id, tgId);

    say(h, "the payroll one", { id: q.messageId!, text: "Which repository?" });
    await waitUntil(() => reactions(h).length >= 2);
    const peek = JSON.parse((await h.runCli(["recv", "--peek", "--channel", "dispatcher"])).stdout.trim());
    const answer = peek.messages.find((m: any) => m.text === "the payroll one");
    assert.equal(answer.inquiry, id, "the answer names the inquiry it belongs to");
    assert.equal(answer.replyTo.quote, "Which repository?".slice(0, 200));
    const shown = JSON.parse((await h.runCli(["inquiries", "show", id])).stdout);
    assert.equal(shown.state, "asked");
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("tg inquiries lists, shows, marks and revives; a revived inquiry is dispatched by its new id", async () => {
  const h = await setupHarness();
  try {
    writeConfig(h);
    const daemon = await start(h);
    say(h, "first thing");
    say(h, "second thing");
    await waitUntil(() => reactions(h).length >= 2);
    const [a, b] = inquiryLines(h).map((l) => l.id as string);

    const list = await h.runCli(["inquiries", "list", "--open"]);
    assert.match(list.stdout, /first thing/);
    assert.match(list.stdout, /second thing/);

    assert.equal((await h.runCli(["inquiries", "mark", a!, "--state", "dropped"])).code, 0);
    const afterDrop = await h.runCli(["inquiries", "list", "--open"]);
    assert.doesNotMatch(afterDrop.stdout, /first thing/);

    // consume the queue, then revive the second one
    const w = spawnWait(h);
    await w.closed;
    assert.equal(JSON.parse((await h.runCli(["recv", "--peek", "--channel", "dispatcher"])).stdout.trim()).messages.length, 0);
    const rev = await h.runCli(["inquiries", "revive", b!]);
    assert.equal(rev.code, 0, rev.stderr);
    const again = JSON.parse((await h.runCli(["recv", "--channel", "dispatcher"])).stdout.trim());
    assert.equal(again.messages.length, 1);
    assert.equal(again.messages[0].text, "second thing");
    assert.equal(again.messages[0].inquiry, b);
    const revivedRow = again.messages[0].id as string;
    assert.notEqual(revivedRow, b);

    const r = await h.runCli(["dispatch", "plain", "--inquiry", revivedRow]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse((await h.runCli(["inquiries", "show", b!])).stdout).state, "handed_off");
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("revive without a dispatcher says there is nowhere to revive to", async () => {
  const h = await setupHarness();
  try {
    const daemon = await start(h);
    say(h, "orphan");
    await waitUntil(() => reactions(h).length >= 1);
    const id = inquiryLines(h)[0]!.id as string;
    const r = await h.runCli(["inquiries", "revive", id]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /nowhere to revive/);
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("without inboxCommands, /ask is an ordinary message and the menu and /help omit the three commands", async () => {
  const h = await setupHarness();
  try {
    writeConfig(h);
    const daemon = await start(h);
    await waitUntil(() => h.fake.sent.some((m) => (m.method as string) === "setMyCommands"));
    const menu = h.fake.sent.find((m) => (m.method as string) === "setMyCommands")!.body.commands as Array<{ command: string }>;
    assert.ok(!menu.some((c) => ["ask", "add", "inbox"].includes(c.command)));
    say(h, "/help");
    await waitUntil(() => h.fake.sent.some((m) => m.method === "sendMessage" && String(m.body.text ?? "").includes("Commands:")));
    const help = String(h.fake.lastMessageTo(h.chatId, (m) => String(m.body.text ?? "").includes("Commands:"))!.body.text);
    assert.doesNotMatch(help, /maestro/i);
    assert.doesNotMatch(help, /\/ask/);
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("with inboxCommands true the three commands stay", async () => {
  const h = await setupHarness();
  try {
    writeConfig(h, { inboxCommands: true });
    const daemon = await start(h);
    await waitUntil(() => h.fake.sent.some((m) => (m.method as string) === "setMyCommands"));
    const menu = h.fake.sent.find((m) => (m.method as string) === "setMyCommands")!.body.commands as Array<{ command: string }>;
    assert.ok(["ask", "add", "inbox"].every((n) => menu.some((c) => c.command === n)));
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("the claude-session target starts a tmux window only in an allowed directory", async () => {
  const h = await setupHarness();
  try {
    const allowed = path.join(h.home, "proj");
    mkdirSync(allowed);
    const tmuxStub = path.join(h.home, "tmux-stub.cjs");
    writeFileSync(tmuxStub, `#!/usr/bin/env node\nrequire("node:fs").appendFileSync(require("node:path").join(__dirname, "tmux.log"), JSON.stringify(process.argv.slice(2)) + "\\n");\n`);
    chmodSync(tmuxStub, 0o755);
    writeConfig(h, { targets: [{ name: "session", description: "start a session", builtin: "claude-session", allowedCwds: [allowed], ack: "Started a session in {{cwd}}" }], defaultTarget: "session" });
    const daemon = await start(h);
    say(h, "build me a thing");
    await waitUntil(() => reactions(h).length >= 1);
    const id = inquiryLines(h)[0]!.id as string;
    h.env.AGENT_TELEGRAM_TMUX_BIN = tmuxStub;

    const bad = await h.runCli(["dispatch", "session", "--inquiry", id, "--param", `cwd=${h.home}`]);
    assert.equal(bad.code, 1);
    assert.match(h.fake.sent.map((m) => String(m.body.text ?? "")).join("\n"), /not one of this target's allowedCwds/);
    assert.ok(!existsSync(path.join(h.home, "tmux.log")));

    const ok = await h.runCli(["dispatch", "session", "--inquiry", id, "--param", `cwd=${allowed}`]);
    assert.equal(ok.code, 0, ok.stderr);
    const logged = JSON.parse(readFileSync(path.join(h.home, "tmux.log"), "utf8").trim());
    assert.equal(logged[0], "new-window");
    assert.ok(logged.includes("claude"), "defaults to claude on PATH");
    assert.equal(logged[logged.length - 1], "build me a thing");
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("tg dispatcher start builds a restart loop in a tmux window, refuses a second one, and stop kills the window", async () => {
  const h = await setupHarness();
  try {
    const tmuxStub = path.join(h.home, "tmux-stub.cjs");
    writeFileSync(
      tmuxStub,
      `#!/usr/bin/env node
const fs = require("node:fs"); const path = require("node:path");
const args = process.argv.slice(2);
fs.appendFileSync(path.join(__dirname, "tmux.log"), JSON.stringify(args) + "\\n");
if (args[0] === "list-windows") { const f = path.join(__dirname, "tmux-windows"); if (fs.existsSync(f)) process.stdout.write(fs.readFileSync(f, "utf8")); else process.exit(1); }
`,
    );
    chmodSync(tmuxStub, 0o755);
    h.env.AGENT_TELEGRAM_TMUX_BIN = tmuxStub;
    writeConfig(h, { session: { tmuxSession: "ship", window: "tg-dispatcher", cwd: "~", allowedTools: ["Bash(tg:*)", "SendMessage"], claudeBin: "/opt/fake/bin/claude" }, model: "sonnet" });
    const daemon = await start(h);

    const started = await h.runCli(["dispatcher", "start"]);
    assert.equal(started.code, 0, started.stderr);
    const calls = readFileSync(path.join(h.home, "tmux.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const create = calls.find((c: string[]) => c[0] === "new-session")!;
    assert.deepEqual(create.slice(0, 5), ["new-session", "-d", "-s", "ship", "-n"]);
    const command = create[create.length - 1] as string;
    assert.match(command, /^while :; do '\/opt\/fake\/bin\/claude' '.*Telegram dispatcher.*' --model 'sonnet' --allowed-tools 'Bash\(tg:\*\),SendMessage' --append-system-prompt-file '.*dispatcher-protocol\.md'; sleep 5; done$/);
    assert.ok(existsSync(path.join(h.home, "state", "dispatcher-protocol.md")));

    // a window of that name already exists: refuse
    writeFileSync(path.join(h.home, "tmux-windows"), "tg-dispatcher\n");
    const second = await h.runCli(["dispatcher", "start"]);
    assert.equal(second.code, 1);
    assert.match(second.stderr, /already exists/);

    const stopped = await h.runCli(["dispatcher", "stop"]);
    assert.equal(stopped.code, 0, stopped.stderr);
    const kill = readFileSync(path.join(h.home, "tmux.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).find((c: string[]) => c[0] === "kill-window")!;
    assert.deepEqual(kill, ["kill-window", "-t", "ship:tg-dispatcher"]);
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("tg dispatcher start refuses while a listener is already on the dispatcher channel", async () => {
  const h = await setupHarness();
  try {
    const tmuxStub = path.join(h.home, "tmux-stub.cjs");
    writeFileSync(tmuxStub, `#!/usr/bin/env node\nrequire("node:fs").appendFileSync(require("node:path").join(__dirname, "tmux.log"), "called\\n");\n`);
    chmodSync(tmuxStub, 0o755);
    h.env.AGENT_TELEGRAM_TMUX_BIN = tmuxStub;
    writeConfig(h);
    const daemon = await start(h);
    const w = spawnWait(h);
    await untilListening(h);
    const r = await h.runCli(["dispatcher", "start"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /already has a listener/);
    assert.ok(!existsSync(path.join(h.home, "tmux.log")));
    w.proc.kill("SIGKILL");
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("tg dispatcher targets lists names and descriptions but not commands", async () => {
  const h = await setupHarness();
  try {
    writeConfig(h);
    const r = await h.runCli(["dispatcher", "targets"]);
    assert.equal(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.defaultTarget, "inbox");
    assert.deepEqual(out.targets.map((t: any) => t.name), ["inbox", "plain"]);
    assert.deepEqual(out.targets[0].params, ["tag"]);
    assert.doesNotMatch(r.stdout, /target\.cjs/);
  } finally {
    await h.teardown();
  }
});

test("tg doctor reports a dispatcher.json problem and a missing target binary", async () => {
  const h = await setupHarness();
  try {
    const daemon = await start(h); // tg doctor asks the daemon, and would otherwise auto-start one nobody cleans up
    writeFileSync(path.join(h.home, "config", "dispatcher.json"), JSON.stringify({ version: 1, defaultTarget: "x", targets: [] }));
    const bad = await h.runCli(["doctor"]);
    assert.match(bad.stdout, /dispatcher: OFF, dispatcher\.json is invalid: defaultTarget "x" is not one of the targets/);
    writeFileSync(path.join(h.home, "config", "dispatcher.json"), JSON.stringify({ version: 1, targets: [{ name: "a", description: "d", argv: ["/no/such/binary"] }] }));
    const warn = await h.runCli(["doctor"]);
    assert.match(warn.stdout, /dispatcher: on, channel dispatcher/);
    assert.match(warn.stdout, /warning: no defaultTarget set/);
    assert.match(warn.stdout, /target "a": "\/no\/such\/binary" is not on PATH/);
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("tg send --reply-to sends the message as a reply", async () => {
  const h = await setupHarness();
  try {
    const daemon = await start(h);
    const r = await h.runCli(["send", "--reply-to", "77", "on it"]);
    assert.equal(r.code, 0, r.stderr);
    const sent = h.fake.sent.find((m) => m.method === "sendMessage")!;
    assert.equal((sent.body.reply_parameters as { message_id: number }).message_id, 77);
    assert.equal((await h.runCli(["send", "--reply-to", "abc", "x"])).code, 1);
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

// ---- a disabled dispatcher can still be run and tried (rollout step 8) ----

test("with enabled false, the session commands work and a trial message reaches the waiting dispatcher", async () => {
  const h = await setupHarness();
  try {
    writeConfig(h, { enabled: false });
    const daemon = await start(h);
    const w = spawnWait(h);
    await waitUntil(async () => /a session is listening on dispatcher/.test((await h.runCli(["status"])).stdout));
    const trial = await h.runCli(["dispatcher", "trial", "TOOLING rollout test, ignore"]);
    assert.equal(trial.code, 0, trial.stderr);
    assert.equal(await w.closed, 0, w.err());
    const out = JSON.parse(w.out().trim());
    assert.equal(out.messages[0].text, "TOOLING rollout test, ignore");
    assert.equal(out.messages[0].tgMessageId, undefined, "a trial message has no Telegram message");

    const logged = inquiryLines(h).find((l) => l.op === "received")!;
    assert.equal(logged.text, "TOOLING rollout test, ignore");
    assert.equal(logged.routedTo, "dispatcher");

    // dispatching it works, and the acknowledgement is a plain message (nothing to reply under)
    const r = await h.runCli(["dispatch", "plain", "--inquiry", out.messages[0].id, "--note", "trial"]);
    assert.equal(r.code, 0, r.stderr);
    const ack = h.fake.sent.find((m) => m.method === "sendMessage" && String(m.body.text ?? "").includes("Sent to plain"))!;
    assert.equal(ack.body.reply_parameters, undefined);
    assert.match(String(ack.body.text), /trial/);
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("with enabled false, real Telegram messages keep the old routing, not the dispatcher", async () => {
  const h = await setupHarness();
  try {
    writeConfig(h, { enabled: false });
    const daemon = await start(h);
    say(h, "an ordinary message");
    await waitUntil(() => reactions(h).length >= 1);
    assert.equal(inquiryLines(h)[0]!.routedTo, null, "unrouted, as before the dispatcher existed");
    assert.equal(JSON.parse((await h.runCli(["recv", "--peek", "--channel", "somebody"])).stdout.trim()).messages.length, 1);
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("with enabled false, only one dispatcher listener is still allowed, and start builds the window", async () => {
  const h = await setupHarness();
  try {
    const tmuxStub = path.join(h.home, "tmux-stub.cjs");
    writeFileSync(tmuxStub, `#!/usr/bin/env node\nconst a = process.argv.slice(2); require("node:fs").appendFileSync(require("node:path").join(__dirname, "tmux.log"), JSON.stringify(a) + "\\n"); if (a[0] === "list-windows") process.exit(1);\n`);
    chmodSync(tmuxStub, 0o755);
    h.env.AGENT_TELEGRAM_TMUX_BIN = tmuxStub;
    writeConfig(h, { enabled: false });
    const daemon = await start(h);
    const started = await h.runCli(["dispatcher", "start"]);
    assert.equal(started.code, 0, started.stderr);
    assert.ok(readFileSync(path.join(h.home, "tmux.log"), "utf8").includes("new-session"));
    const first = spawnWait(h);
    await sleep(500);
    const second = spawnWait(h);
    assert.equal(await second.closed, 1);
    assert.match(second.err(), /already has a listener/);
    first.proc.kill("SIGKILL");
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("trial needs a valid dispatcher.json", async () => {
  const h = await setupHarness();
  try {
    const daemon = await start(h);
    const r = await h.runCli(["dispatcher", "trial", "x"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /no dispatcher\.json/);
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("session.name is passed to claude with --name, ahead of the variadic --allowed-tools", async () => {
  const h = await setupHarness();
  try {
    const tmuxStub = path.join(h.home, "tmux-stub.cjs");
    writeFileSync(tmuxStub, `#!/usr/bin/env node\nconst a = process.argv.slice(2); require("node:fs").appendFileSync(require("node:path").join(__dirname, "tmux.log"), JSON.stringify(a) + "\\n"); if (a[0] === "list-windows") process.exit(1);\n`);
    chmodSync(tmuxStub, 0o755);
    h.env.AGENT_TELEGRAM_TMUX_BIN = tmuxStub;
    writeConfig(h, { session: { tmuxSession: "ship", window: "tg-dispatcher", cwd: "~", name: "TG-DISPATCHER" } });
    const daemon = await start(h);
    const started = await h.runCli(["dispatcher", "start"]);
    assert.equal(started.code, 0, started.stderr);
    const create = readFileSync(path.join(h.home, "tmux.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).find((c: string[]) => c[0] === "new-session")!;
    const command = create[create.length - 1] as string;
    assert.match(command, / --model 'sonnet' --name 'TG-DISPATCHER' --allowed-tools /);
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("the protocol sends to the cached address and looks up a live row only when the address is stale or the name is bare", async () => {
  const { DISPATCHER_PROTOCOL } = await import("../src/dispatcher/protocol.ts");
  const text = DISPATCHER_PROTOCOL.join("\n");
  assert.match(text, /nudge\.address/);
  assert.match(text, /stale/);
  assert.match(text, /\[ref\]|<ref>/);
  assert.match(text, /ListAgents/);
  assert.match(text, /bare name/);
});

test("the acknowledgement is easy to read: the confirmation on its own line, the note after a blank line, the header kept", async () => {
  const h = await setupHarness();
  try {
    writeConfig(h);
    const daemon = await start(h);
    say(h, "file this");
    await waitUntil(() => reactions(h).length >= 1);
    const id = inquiryLines(h)[0]!.id as string;
    const r = await h.runCli(["dispatch", "inbox", "--inquiry", id, "--param", "tag=x", "--note", "treated as a task"]);
    assert.equal(r.code, 0, r.stderr);
    const ack = String(h.fake.sent.find((m) => m.method === "sendMessage" && String(m.body.text ?? "").includes("Filed as ref-1"))!.body.text);
    const lines = ack.split("\n");
    assert.equal(lines[0], "Filed as ref-1", "no header: the message starts with the confirmation");
    assert.equal(lines[1], "");
    assert.equal(lines[2], "<i>treated as a task</i>");
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("a failed hand-off tells Reid what failed on short lines", async () => {
  const h = await setupHarness();
  try {
    writeConfig(h);
    writeFileSync(path.join(h.home, "target-fail"), "");
    const daemon = await start(h);
    say(h, "do a thing");
    await waitUntil(() => reactions(h).length >= 1);
    const id = inquiryLines(h)[0]!.id as string;
    await h.runCli(["dispatch", "plain", "--inquiry", id]);
    const warn = String(h.fake.sent.find((m) => m.method === "sendMessage" && String(m.body.text ?? "").includes("target is down"))!.body.text);
    const lines = warn.split("\n");
    assert.equal(lines[0], "⚠️ <b>Could not hand this to plain</b>");
    assert.equal(lines[1], "<code>target is down</code>");
    assert.equal(lines[2], "The message is still open.");
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("the kickoff prompt does not arm a wait, so the skill's re-arm-first rule arms exactly one", async () => {
  const h = await setupHarness();
  try {
    const tmuxStub = path.join(h.home, "tmux-stub.cjs");
    writeFileSync(tmuxStub, `#!/usr/bin/env node\nconst a = process.argv.slice(2); require("node:fs").appendFileSync(require("node:path").join(__dirname, "tmux.log"), JSON.stringify(a) + "\\n"); if (a[0] === "list-windows") process.exit(1);\n`);
    chmodSync(tmuxStub, 0o755);
    h.env.AGENT_TELEGRAM_TMUX_BIN = tmuxStub;
    writeConfig(h);
    const daemon = await start(h);
    assert.equal((await h.runCli(["dispatcher", "start"])).code, 0);
    const create = readFileSync(path.join(h.home, "tmux.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).find((c: string[]) => c[0] === "new-session")!;
    const command = create[create.length - 1] as string;
    assert.match(command, /Load the telegram-dispatcher skill and follow it/);
    assert.doesNotMatch(command, /dispatcher wait/, "the skill's first step arms the wait; the kickoff must not arm a second");
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("the protocol says a refused second wait is harmless", async () => {
  const { DISPATCHER_PROTOCOL } = await import("../src/dispatcher/protocol.ts");
  assert.match(DISPATCHER_PROTOCOL.join("\n"), /already has a listener/);
});

// ---- the wait survives a daemon restart (a launchd restart or a crash while nobody is watching) ----

test("tg dispatcher wait reconnects when the daemon dies and a new one starts, and still delivers the next message", async () => {
  const h = await setupHarness();
  try {
    writeConfig(h);
    h.env.AGENT_TELEGRAM_NO_AUTOSTART = "1"; // the test starts the replacement daemon itself
    h.env.AGENT_TELEGRAM_RECONNECT_MS = "60000";
    h.env.AGENT_TELEGRAM_RECONNECT_BASE_MS = "100";
    const first = await start(h);
    const w = spawnWait(h);
    await untilListening(h);

    first.kill("SIGKILL"); // a crash: the socket and lock files are left behind
    await sleep(800);
    assert.equal(w.proc.exitCode, null, "the wait is still alive while the daemon is gone");
    const second = await start(h);
    await untilListening(h);

    assert.equal((await h.runCli(["dispatcher", "trial", "after the restart"])).code, 0);
    assert.equal(await w.closed, 0, w.err());
    assert.equal(JSON.parse(w.out().trim()).messages[0].text, "after the restart");
    second.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("tg dispatcher wait gives up after the reconnect limit with a clear message and a non-zero exit", async () => {
  const h = await setupHarness();
  try {
    writeConfig(h);
    h.env.AGENT_TELEGRAM_NO_AUTOSTART = "1";
    h.env.AGENT_TELEGRAM_RECONNECT_MS = "2000";
    h.env.AGENT_TELEGRAM_RECONNECT_BASE_MS = "100";
    const daemon = await start(h);
    const w = spawnWait(h);
    await untilListening(h);
    daemon.kill("SIGKILL");
    const code = await w.closed;
    assert.equal(code, 1);
    assert.match(w.err(), /lost the daemon/);
    assert.match(w.err(), /tg dispatcher wait/);
    assert.equal(w.out().trim(), "", "nothing on stdout: this is a failure, not a result");
  } finally {
    await h.teardown();
  }
});

test("a refusal from the daemon is not retried", async () => {
  const h = await setupHarness();
  try {
    writeConfig(h);
    h.env.AGENT_TELEGRAM_NO_AUTOSTART = "1";
    h.env.AGENT_TELEGRAM_RECONNECT_MS = "60000";
    const daemon = await start(h);
    const first = spawnWait(h);
    await untilListening(h);
    const started = Date.now();
    const second = spawnWait(h);
    assert.equal(await second.closed, 1);
    assert.ok(Date.now() - started < 5000, "failed at once, did not sit in a retry loop");
    assert.match(second.err(), /already has a listener/);
    first.proc.kill("SIGKILL");
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("the protocol tells the session to re-arm after a wait that failed because the daemon was gone", async () => {
  const { DISPATCHER_PROTOCOL } = await import("../src/dispatcher/protocol.ts");
  assert.match(DISPATCHER_PROTOCOL.join("\n"), /lost the daemon/);
});

// ---- which tmux session a new Claude session opens in ----

async function newSessionArgv(h: Harness, session: Record<string, unknown>, inTmux: boolean): Promise<string[]> {
  const allowed = path.join(h.home, "proj");
  mkdirSync(allowed, { recursive: true });
  const stub = path.join(h.home, "tmux-stub.cjs");
  writeFileSync(stub, `#!/usr/bin/env node\nrequire("node:fs").appendFileSync(require("node:path").join(__dirname, "tmux.log"), JSON.stringify(process.argv.slice(2)) + "\\n");\n`);
  chmodSync(stub, 0o755);
  h.env.AGENT_TELEGRAM_TMUX_BIN = stub;
  if (inTmux) h.env.TMUX = "/tmp/tmux-501/default,1,0";
  writeConfig(h, {
    session,
    targets: [{ name: "session", description: "start a session", builtin: "claude-session", allowedCwds: [allowed], ack: "ok" }],
    defaultTarget: "session",
  });
  const daemon = await start(h);
  say(h, "do a thing");
  await waitUntil(() => reactions(h).length >= 1);
  const id = inquiryLines(h)[0]!.id as string;
  const r = await h.runCli(["dispatch", "session", "--inquiry", id, "--param", `cwd=${allowed}`]);
  assert.equal(r.code, 0, r.stderr);
  daemon.kill("SIGKILL");
  return JSON.parse(readFileSync(path.join(h.home, "tmux.log"), "utf8").trim().split("\n").pop()!);
}

test("a session.tmuxSession set in the config is where the new window opens", async () => {
  const h = await setupHarness();
  try {
    const argv = await newSessionArgv(h, { tmuxSession: "ship", window: "tg-dispatcher", cwd: "~" }, true);
    const t = argv.indexOf("-t");
    assert.ok(t >= 0, "new-window is given a target session");
    assert.equal(argv[t + 1], "ship:");
    assert.equal(argv[0], "new-window");
  } finally {
    await h.teardown();
  }
});

test("without a tmuxSession in the config, a dispatcher inside tmux opens the window in its own session (no -t)", async () => {
  const h = await setupHarness();
  try {
    const argv = await newSessionArgv(h, { window: "tg-dispatcher", cwd: "~" }, true);
    assert.equal(argv[0], "new-window");
    assert.ok(!argv.includes("-t"), "tmux uses the session of the pane that ran the command");
  } finally {
    await h.teardown();
  }
});

test("without a tmuxSession and outside tmux, the window opens in the default session, never in whichever was used last", async () => {
  const h = await setupHarness();
  try {
    const argv = await newSessionArgv(h, { window: "tg-dispatcher", cwd: "~" }, false);
    const t = argv.indexOf("-t");
    assert.ok(t >= 0);
    assert.equal(argv[t + 1], "main:");
  } finally {
    await h.teardown();
  }
});

// ---- the nudge address: a name, a cached address, and a live-row fallback ----

async function dispatchedInquiry(h: Harness, nudge: Record<string, unknown>): Promise<{ id: string; out: any }> {
  const target = writeTarget(h);
  writeFileSync(
    path.join(h.home, "config", "dispatcher.json"),
    JSON.stringify({
      version: 1,
      defaultTarget: "inbox",
      targets: [{ name: "inbox", description: "d", argv: [process.execPath, target], ack: "Filed as {{stdout1}}", nudge }],
    }),
  );
  say(h, "please look at this");
  await waitUntil(() => reactions(h).length >= 1);
  const id = inquiryLines(h)[0]!.id as string;
  const r = await h.runCli(["dispatch", "inbox", "--inquiry", id]);
  assert.equal(r.code, 0, r.stderr);
  return { id, out: JSON.parse(r.stdout.trim()) };
}

test("a nudge with a bare name carries no address until one is recorded", async () => {
  const h = await setupHarness();
  try {
    const daemon = await start(h);
    const { out } = await dispatchedInquiry(h, { to: "SessionA", template: "item {{ref}}" });
    assert.equal(out.nudge.to, "SessionA");
    assert.equal(out.nudge.address, undefined);
    assert.equal(out.nudge.target, "inbox");
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("a configured address is the first cached address", async () => {
  const h = await setupHarness();
  try {
    const daemon = await start(h);
    const { out } = await dispatchedInquiry(h, { to: "SessionA", address: "bridge:session_OLD", template: "x" });
    assert.equal(out.nudge.address, "bridge:session_OLD");
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("tg dispatch address records the live address, and the next nudge carries it instead of the configured one", async () => {
  const h = await setupHarness();
  try {
    const daemon = await start(h);
    await dispatchedInquiry(h, { to: "SessionA", address: "bridge:session_OLD", template: "x" });
    const rec = await h.runCli(["dispatch", "address", "inbox", "SessionA [abc123]"]);
    assert.equal(rec.code, 0, rec.stderr);
    say(h, "second message");
    await waitUntil(() => inquiryLines(h).filter((l) => l.op === "received").length >= 2);
    const id2 = inquiryLines(h).filter((l) => l.op === "received")[1]!.id as string;
    const r = await h.runCli(["dispatch", "inbox", "--inquiry", id2]);
    assert.equal(JSON.parse(r.stdout.trim()).nudge.address, "SessionA [abc123]");
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("tg dispatch address refuses control characters, a very long value and an unknown target", async () => {
  const h = await setupHarness();
  try {
    const daemon = await start(h);
    await dispatchedInquiry(h, { to: "SessionA", template: "x" });
    assert.equal((await h.runCli(["dispatch", "address", "inbox", "bad\u0007value"])).code, 1);
    assert.equal((await h.runCli(["dispatch", "address", "inbox", "x".repeat(300)])).code, 1);
    assert.equal((await h.runCli(["dispatch", "address", "nope", "SessionA [abc]"])).code, 1);
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("unreachable tells the user once per outage, under their message, and not again until an address is recorded", async () => {
  const h = await setupHarness();
  try {
    const daemon = await start(h);
    const { id, out } = await dispatchedInquiry(h, { to: "SessionA", template: "x" });
    const tgId = inquiryLines(h)[0]!.tgMessageId as number;
    const first = await h.runCli(["dispatch", "unreachable", "inbox", "--inquiry", id]);
    assert.equal(first.code, 0, first.stderr);
    assert.equal(JSON.parse(first.stdout.trim()).status, "notified");
    const msg = h.fake.sent.find((m) => m.method === "sendMessage" && /could not reach/i.test(String(m.body.text ?? "")))!;
    assert.match(String(msg.body.text), /could not reach SessionA directly; the item is filed as <code>ref-1<\/code>/i);
    assert.equal((msg.body.reply_parameters as { message_id: number }).message_id, tgId);
    assert.ok(out.nudge);

    const second = await h.runCli(["dispatch", "unreachable", "inbox", "--inquiry", id]);
    assert.equal(JSON.parse(second.stdout.trim()).status, "already_notified");
    assert.equal(h.fake.sent.filter((m) => /could not reach/i.test(String(m.body.text ?? ""))).length, 1);

    await h.runCli(["dispatch", "address", "inbox", "SessionA [live1]"]); // it came back
    const third = await h.runCli(["dispatch", "unreachable", "inbox", "--inquiry", id]);
    assert.equal(JSON.parse(third.stdout.trim()).status, "notified", "a new outage is announced again");
    daemon.kill("SIGKILL");
  } finally {
    await h.teardown();
  }
});

test("the protocol: send to the cached address, on a stale-address error look up the live row, record it, or report unreachable", async () => {
  const { DISPATCHER_PROTOCOL } = await import("../src/dispatcher/protocol.ts");
  const text = DISPATCHER_PROTOCOL.join("\n");
  assert.match(text, /nudge\.address|`address`/);
  assert.match(text, /tg dispatch address/);
  assert.match(text, /tg dispatch unreachable/);
  assert.match(text, /not offline|live, non-offline|live row/);
});

test("target names that clash with dispatch subcommands are refused", () => {
  for (const name of ["ask", "address", "unreachable"]) {
    assert.throws(() => parseDispatcherConfig({ version: 1, defaultTarget: name, targets: [{ name, description: "d", argv: ["true"] }] }), /reserved|name/);
  }
});
