import { test } from "node:test";
import assert from "node:assert/strict";
import { markdownToTelegramHtml, splitMessage } from "../src/core/markdown.ts";

test("bold, italic, code, and links convert to Telegram HTML", () => {
  const out = markdownToTelegramHtml("**bold** *italic* `code` [link](https://example.com)");
  assert.equal(out, '<b>bold</b> <i>italic</i> <code>code</code> <a href="https://example.com">link</a>');
});

test("list items become bullet lines", () => {
  const out = markdownToTelegramHtml("- one\n- two\n* three");
  assert.equal(out, "• one\n• two\n• three");
});

test("pre blocks are escaped but not otherwise transformed", () => {
  const out = markdownToTelegramHtml("```\n<b>not bold</b> **not bold**\n```");
  assert.equal(out, "<pre>\n&lt;b&gt;not bold&lt;/b&gt; **not bold**\n</pre>");
});

test("HTML special characters in plain text are escaped", () => {
  const out = markdownToTelegramHtml("1 < 2 & 3 > 1");
  assert.equal(out, "1 &lt; 2 &amp; 3 &gt; 1");
});

test("messages under the limit are not split", () => {
  const text = "short message";
  assert.deepEqual(splitMessage(text), [text]);
});

test("long messages split on paragraph boundaries when possible", () => {
  const paragraph = "x".repeat(2000);
  const text = [paragraph, paragraph, paragraph].join("\n\n");
  const chunks = splitMessage(text, 4096);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.length <= 4096);
  assert.equal(chunks.join("\n\n"), text);
});

test("a single paragraph longer than the limit is hard-split", () => {
  const text = "y".repeat(9000);
  const chunks = splitMessage(text, 4096);
  assert.equal(chunks.length, 3);
  assert.equal(chunks.join(""), text);
  for (const chunk of chunks) assert.ok(chunk.length <= 4096);
});
