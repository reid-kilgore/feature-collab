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
