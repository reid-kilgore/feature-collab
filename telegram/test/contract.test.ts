import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePayload, ContractError } from "../src/contract/payload.ts";

test("accepts a minimal valid payload and defaults allowOther to true", () => {
  const payload = validatePayload({
    version: 1,
    questions: [{ id: "q1", prompt: "Pick one", type: "single", options: [{ value: "a", label: "A" }] }],
  });
  assert.equal(payload.questions[0]!.allowOther, true);
});

test("rejects a missing questions array", () => {
  assert.throws(() => validatePayload({ version: 1 }), ContractError);
});

test("rejects a choice question with no options", () => {
  assert.throws(() => validatePayload({ version: 1, questions: [{ id: "q1", prompt: "p", type: "single" }] }), ContractError);
});

test("rejects duplicate question ids", () => {
  assert.throws(
    () =>
      validatePayload({
        version: 1,
        questions: [
          { id: "q1", prompt: "a", type: "text" },
          { id: "q1", prompt: "b", type: "text" },
        ],
      }),
    ContractError,
  );
});

test("accepts the tg extensions: timeoutSeconds, onTimeout, and per-question default", () => {
  const payload = validatePayload({
    version: 1,
    timeoutSeconds: 3600,
    onTimeout: "default",
    questions: [
      { id: "q1", prompt: "Pick one", type: "single", options: [{ value: "a", label: "A" }], default: "a" },
    ],
  });
  assert.equal(payload.timeoutSeconds, 3600);
  assert.equal(payload.onTimeout, "default");
});

test("rejects a default that does not reference a known option", () => {
  assert.throws(
    () =>
      validatePayload({
        version: 1,
        questions: [{ id: "q1", prompt: "Pick one", type: "single", options: [{ value: "a", label: "A" }], default: "z" }],
      }),
    ContractError,
  );
});

test("rejects an invalid onTimeout value", () => {
  assert.throws(
    () =>
      validatePayload({
        version: 1,
        onTimeout: "retry",
        questions: [{ id: "q1", prompt: "p", type: "text" }],
      }),
    ContractError,
  );
});

test("accepts a document with inline markdown and rejects one with both markdown and path", () => {
  assert.doesNotThrow(() =>
    validatePayload({
      version: 1,
      questions: [{ id: "q1", prompt: "p", type: "text" }],
      documents: [{ id: "d1", title: "Doc", markdown: "hello" }],
    }),
  );
  assert.throws(
    () =>
      validatePayload({
        version: 1,
        questions: [{ id: "q1", prompt: "p", type: "text" }],
        documents: [{ id: "d1", title: "Doc", markdown: "hello", path: "x.md" }],
      }),
    ContractError,
  );
});
