// The chat menu button's open-set count: text follows the count, unchanged counts send nothing,
// bursts send one call, failures are logged and retried on the next change.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createMenuCountUpdater, menuText } from "../src/miniapp/menu-count.ts";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function rig(opts: { failFirst?: boolean } = {}) {
  let count = 0;
  const sent: string[] = [];
  const logs: string[] = [];
  let failures = opts.failFirst ? 1 : 0;
  const updater = createMenuCountUpdater({
    getCount: () => count,
    setText: async (text) => {
      if (failures > 0) {
        failures--;
        throw new Error("telegram down");
      }
      sent.push(text);
    },
    log: (l) => logs.push(l),
    debounceMs: 20,
  });
  return { updater, sent, logs, setCount: (n: number) => void (count = n) };
}

test("the text is plain at zero and carries the count above zero", () => {
  assert.equal(menuText(0), "Questions");
  assert.equal(menuText(1), "Questions (1)");
  assert.equal(menuText(12), "Questions (12)");
});

test("the text follows the count, and an unchanged count sends no call", async () => {
  const t = rig();
  await t.updater.syncNow();
  assert.deepEqual(t.sent, ["Questions"]);
  t.setCount(2);
  t.updater.schedule();
  await wait(60);
  assert.deepEqual(t.sent, ["Questions", "Questions (2)"]);
  // A set came and went inside the debounce window: same count, no call.
  t.setCount(3);
  t.updater.schedule();
  t.setCount(2);
  await wait(60);
  assert.deepEqual(t.sent, ["Questions", "Questions (2)"]);
  t.setCount(0);
  t.updater.schedule();
  await wait(60);
  assert.deepEqual(t.sent, ["Questions", "Questions (2)", "Questions"]);
});

test("a burst of changes sends one call with the final count", async () => {
  const t = rig();
  await t.updater.syncNow();
  for (let n = 1; n <= 5; n++) {
    t.setCount(n);
    t.updater.schedule();
  }
  await wait(60);
  assert.deepEqual(t.sent, ["Questions", "Questions (5)"]);
});

test("a failed call is logged, not thrown, and the next change tries again", async () => {
  const t = rig({ failFirst: true });
  await t.updater.syncNow();
  assert.deepEqual(t.sent, []);
  assert.match(t.logs[0]!, /setChatMenuButton failed: telegram down/);
  // The count is still the one never shown, so even an unchanged count is sent on the next schedule.
  t.updater.schedule();
  await wait(60);
  assert.deepEqual(t.sent, ["Questions"]);
});
