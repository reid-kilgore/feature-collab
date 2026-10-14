// Telegram Mini App initData validation: the only lock on the data API.

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateInitData } from "../src/miniapp/initdata.ts";
import { initDataFor, signInitData, TEST_BOT_TOKEN } from "./support/miniapp.ts";

const NOW_S = 1_800_000_000;
const opts = { botToken: TEST_BOT_TOKEN, allowedUserId: "42", maxAgeSeconds: 3600, nowMs: NOW_S * 1000 };

test("valid initData from the allowed user passes", () => {
  const result = validateInitData(initDataFor(42, NOW_S - 10), opts);
  assert.deepEqual(result, { ok: true, userId: "42", authDate: NOW_S - 10 });
});

test("a field changed after signing is rejected", () => {
  const good = new URLSearchParams(initDataFor(42, NOW_S));
  good.set("user", JSON.stringify({ id: 42, first_name: "Mallory" }));
  assert.equal(validateInitData(good.toString(), opts).ok, false);
  const addedField = new URLSearchParams(initDataFor(42, NOW_S));
  addedField.set("start_param", "x");
  assert.equal(validateInitData(addedField.toString(), opts).ok, false);
});

test("a hash signed with a different bot token is rejected", () => {
  assert.equal(validateInitData(initDataFor(42, NOW_S, {}, "999:otherbottokenotherbottokenotherbot"), opts).ok, false);
});

test("a missing, malformed, or short hash is rejected", () => {
  const noHash = new URLSearchParams(initDataFor(42, NOW_S));
  noHash.delete("hash");
  assert.equal(validateInitData(noHash.toString(), opts).ok, false);
  const shortHash = new URLSearchParams(initDataFor(42, NOW_S));
  shortHash.set("hash", "abcd");
  assert.equal(validateInitData(shortHash.toString(), opts).ok, false);
  assert.equal(validateInitData("", opts).ok, false);
  assert.equal(validateInitData(undefined, opts).ok, false);
});

test("initData older than the maximum age is rejected, one second inside is accepted", () => {
  const expired = validateInitData(initDataFor(42, NOW_S - 3601), opts);
  assert.deepEqual(expired, { ok: false, reason: "expired" });
  assert.equal(validateInitData(initDataFor(42, NOW_S - 3600), opts).ok, true);
});

test("initData dated in the future beyond clock skew is rejected", () => {
  assert.equal(validateInitData(initDataFor(42, NOW_S + 30), opts).ok, true);
  assert.deepEqual(validateInitData(initDataFor(42, NOW_S + 600), opts), { ok: false, reason: "from the future" });
});

test("validly signed initData for another user is rejected", () => {
  assert.deepEqual(validateInitData(initDataFor(43, NOW_S), opts), { ok: false, reason: "user not allowed" });
});

test("a repeated field is rejected even when the first copy is signed", () => {
  const signed = initDataFor(42, NOW_S);
  assert.equal(validateInitData(`${signed}&auth_date=${NOW_S}`, opts).ok, false);
});

test("a signed payload with no user, or a non-numeric auth_date, is rejected", () => {
  assert.equal(validateInitData(signInitData({ auth_date: String(NOW_S), query_id: "x" }), opts).ok, false);
  assert.equal(validateInitData(signInitData({ auth_date: "soon", user: JSON.stringify({ id: 42 }) }), opts).ok, false);
});
