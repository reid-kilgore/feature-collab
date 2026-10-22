// What the setup guide promises about new sessions must match what was seen when one was started for real.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Line breaks in the markdown are not part of the wording.
const guide = readFileSync(path.join(root, "docs/SETUP-GUIDE.md"), "utf8").replace(/\s+/g, " ");
const part61 = guide.slice(guide.indexOf("### 6.1"), guide.indexOf("### 6.2"));

test("guide 6.1 says a new session uses the person's own model and permission mode, and to choose it on purpose", () => {
  assert.match(part61, /own default model/);
  assert.match(part61, /permission mode/);
  assert.match(part61, /on purpose/);
});

test("guide 6.1 does not promise that a new session always asks first", () => {
  assert.doesNotMatch(part61, /It asks before anything risky/);
  assert.match(part61, /only if their settings make it ask/);
});

test("guide 6.1 says the folder trust step is required, and why", () => {
  assert.match(part61, /Required/);
  assert.match(part61, /trust/);
  assert.match(part61, /never starts working|stops at the trust question/);
});

test("guide says which tmux session the new window opens in", () => {
  assert.match(guide, /same tmux session as the dispatcher|session\.tmuxSession/);
});
