// The write-up for other people who might use this tool must not mention maestro, although the
// maintainer's own setup uses it heavily (Reid, 2026-10-22). Files here are the public ones: the
// README, both skills, the example config, and the text the dispatcher session is handed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DISPATCHER_PROTOCOL } from "../src/dispatcher/protocol.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

for (const file of ["README.md", "skill/SKILL.md", "skill/AGENTS-snippet.md", "skill/dispatcher/SKILL.md", "examples/dispatcher.example.json"]) {
  test(`${file} does not mention maestro`, () => {
    assert.doesNotMatch(readFileSync(path.join(root, file), "utf8"), /maestro/i);
  });
}

test("the protocol text handed to the dispatcher does not mention maestro", () => {
  assert.doesNotMatch(DISPATCHER_PROTOCOL.join("\n"), /maestro/i);
});

test("the example config is valid", async () => {
  const { parseDispatcherConfig } = await import("../src/dispatcher/config.ts");
  const parsed = parseDispatcherConfig(JSON.parse(readFileSync(path.join(root, "examples/dispatcher.example.json"), "utf8")));
  assert.equal(parsed.defaultTarget, "notes");
});

for (const file of ["skill/SKILL.md", "skill/dispatcher/SKILL.md"]) {
  test(`${file} has a Writing for Telegram section that covers lines, bold, code, short messages, tables, and pictures`, () => {
    const text = readFileSync(path.join(root, file), "utf8");
    const at = text.indexOf("## Writing for Telegram");
    assert.ok(at >= 0, "missing the section");
    const section = text.slice(at);
    for (const needle of [/answer/i, /one fact per line|short bullets/i, /bold/i, /code/i, /table/i, /--image/, /1024/, /phone/i]) {
      assert.match(section, needle);
    }
  });
}

test("the protocol reminder carries a one-line formatting rule", () => {
  assert.match(DISPATCHER_PROTOCOL.join("\n"), /phone/i);
  assert.match(DISPATCHER_PROTOCOL.join("\n"), /no tables/i);
});

// The setup guide is handed to someone who is not the maintainer, so it names none of the maintainer's tools,
// people, machines or paths.
test("docs/SETUP-GUIDE.md names no maintainer tools, people, machines or paths", () => {
  const text = readFileSync(path.join(root, "docs/SETUP-GUIDE.md"), "utf8");
  for (const forbidden of [/maestro/i, /\breid\b/i, /\bmbp\b/, /\bduo\b/i, /REDD/i, /\/Users\//, /passcom/i]) {
    assert.doesNotMatch(text, forbidden);
  }
});

test("docs/SETUP-GUIDE.md covers every part it promises", () => {
  const text = readFileSync(path.join(root, "docs/SETUP-GUIDE.md"), "utf8");
  for (const heading of [/## Part 1\. Create the bot/, /## Part 2\. Install the tool/, /## Part 3\. Link the skills/, /## Part 4\. The dispatcher/, /## Part 5\. Optional: Tailscale/, /## Part 6\. What to use it for/, /## Part 7\. Safety/]) {
    assert.match(text, heading);
  }
  for (const needle of [/BotFather/, /tg setup/, /tg doctor/, /launchd/, /telegram-dispatcher/, /dispatcher\.json/, /claude-session|new-session/, /tg dispatcher start/, /tailscale\.json/, /device-code/, /tg ask/, /"enabled": false/, /tg dispatcher stop/]) {
    assert.match(text, needle);
  }
  assert.doesNotMatch(text, /\d{6,}:[A-Za-z0-9_-]{30,}/, "no bot token shaped string");
});
