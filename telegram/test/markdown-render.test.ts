// What the chat and the Mini App both show for a message, a prompt and an option description written in
// Markdown: headings as bold lines, bold, italic, lists, inline code, [label](url) links, and bare URLs as
// links. One converter (src/core/markdown.ts) produces the chat HTML and the Mini App's nodes. Only http and
// https URLs become links, and nothing the author writes can add a tag or an attribute.

import { test } from "node:test";
import assert from "node:assert/strict";
import { markdownToTelegramHtml, markdownInline, markdownToNodes } from "../src/core/markdown.ts";
import type { MdNode } from "../src/core/markdown.ts";
import { renderHeader, renderQuestionView } from "../src/transports/telegram/render.ts";

// The real shape of the review sets: bold labels, bare URLs on their own lines.
const REVIEW_MESSAGE =
  "**What it is:** Tartine Bakery's opt-in so a team member confirms manager edits to their time cards.\n\n**Start here, walkthrough:** https://claude.ai/artifact/UCUtLqbknWx75xrSDNYUuB\n**Text bundle (criteria, evidence):** https://claude.ai/artifact/Vg3GhzzDaoRSXWfrbLzECV\n\nCI green.";

test("[label](url) shows only the label, as a link", () => {
  assert.equal(markdownToTelegramHtml("[Walkthrough](https://claude.ai/artifact/abc)"), '<a href="https://claude.ai/artifact/abc">Walkthrough</a>');
});

test("a bare URL becomes a link that shows the URL", () => {
  assert.equal(markdownToTelegramHtml("see https://example.com/a?b=1&c=2 now"), 'see <a href="https://example.com/a?b=1&amp;c=2">https://example.com/a?b=1&amp;c=2</a> now');
});

test("a bare URL does not swallow the punctuation that ends the sentence", () => {
  assert.equal(markdownToTelegramHtml("Open https://example.com/x."), 'Open <a href="https://example.com/x">https://example.com/x</a>.');
  assert.equal(markdownToTelegramHtml("(see https://example.com/x)"), '(see <a href="https://example.com/x">https://example.com/x</a>)');
  assert.equal(markdownToTelegramHtml("https://example.com/a_(b)"), '<a href="https://example.com/a_(b)">https://example.com/a_(b)</a>');
});

test("a URL inside a [label](url) link, or inside code, is not linked a second time", () => {
  assert.equal(markdownToTelegramHtml("[https://a.com](https://a.com)"), '<a href="https://a.com">https://a.com</a>');
  assert.equal(markdownToTelegramHtml("run `curl https://a.com/x`"), "run <code>curl https://a.com/x</code>");
});

test("underscores in a URL are not read as italic", () => {
  assert.equal(markdownToTelegramHtml("https://a.com/a_b_c"), '<a href="https://a.com/a_b_c">https://a.com/a_b_c</a>');
});

test("headings become bold lines, whatever their level", () => {
  assert.equal(markdownToTelegramHtml("# Title\n## Sub\ntext"), "<b>Title</b>\n<b>Sub</b>\ntext");
  assert.equal(markdownToTelegramHtml("## **already** bold"), "<b>already bold</b>");
  assert.equal(markdownToTelegramHtml("#hashtag"), "#hashtag", "a # with no space is not a heading");
});

test("only http and https URLs become links; anything else stays plain text", () => {
  for (const url of ["javascript:alert(1)", "tg://resolve?domain=x", "file:///etc/passwd", "data:text/html,x", "ftp://a.com", "//a.com"]) {
    const out = markdownToTelegramHtml(`[click](${url})`);
    assert.doesNotMatch(out, /<a /, url);
    assert.match(out, /click/);
  }
});

test("nothing the author writes can add a tag or an attribute", () => {
  assert.equal(markdownToTelegramHtml('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror="alert(1)"&gt;');
  const quoteBreak = markdownToTelegramHtml('[x](https://a.com" onclick="evil)');
  assert.doesNotMatch(quoteBreak, /<[^>]*onclick/, "the quote ends the URL; the rest is text outside any tag");
  assert.doesNotMatch(markdownToTelegramHtml('https://a.com/"><script>x</script>'), /<script/);
  assert.doesNotMatch(markdownToTelegramHtml("[<b>x</b>](https://a.com)"), /<b>x/);
});

test("the review set's message reads as bold labels and two links", () => {
  const html = markdownToTelegramHtml(REVIEW_MESSAGE);
  assert.match(html, /<b>What it is:<\/b>/);
  assert.match(html, /<b>Start here, walkthrough:<\/b> <a href="https:\/\/claude\.ai\/artifact\/UCUtLqbknWx75xrSDNYUuB">/);
  assert.equal((html.match(/<a /g) ?? []).length, 2);
  assert.doesNotMatch(html, /\*\*/);
});

test("existing output is unchanged: bold, italic, code, lists, pre", () => {
  assert.equal(markdownToTelegramHtml("**b** *i* `c`\n- one\n* two"), "<b>b</b> <i>i</i> <code>c</code>\n• one\n• two");
  assert.equal(markdownToTelegramHtml("```\n<x> **y**\n```"), "<pre>\n&lt;x&gt; **y**\n</pre>");
});

// ---- inline rendering for a prompt or a description ----

test("markdownInline keeps links, code and italics, and can drop bold for text that is already bold", () => {
  assert.equal(markdownInline("Use **this** or [that](https://a.com)"), 'Use <b>this</b> or <a href="https://a.com">that</a>');
  assert.equal(markdownInline("Use **this** or `that`", { bold: false }), "Use this or <code>that</code>");
});

// ---- the chat path ----

test("the chat header message renders the review set's Markdown", () => {
  const html = renderHeader({ version: 1, title: "Review", message: REVIEW_MESSAGE, questions: [] } as never)!;
  assert.match(html, /<a href="https:\/\/claude\.ai\/artifact\/UCUtLqbknWx75xrSDNYUuB">/);
  assert.doesNotMatch(html, /\*\*/);
});

test("a question prompt and option descriptions render links in chat, with no nested bold", () => {
  const view = renderQuestionView({
    shortId: "abc",
    index: 0,
    total: 2,
    selected: [],
    question: {
      id: "q",
      prompt: "Read [the page](https://a.com/p) and **decide**",
      type: "single",
      options: [{ value: "a", label: "A: keep", description: "Cheapest. See [notes](https://a.com/n)." }],
    },
  });
  assert.match(view.text, /^<b>Q1\/2 — Read <a href="https:\/\/a\.com\/p">the page<\/a> and decide<\/b>/);
  assert.match(view.text, /• <b>A: keep<\/b> — Cheapest\. See <a href="https:\/\/a\.com\/n">notes<\/a>\./);
  assert.doesNotMatch(view.text, /<b>[^<]*<b>/);
});

// ---- the nodes the Mini App page builds from ----

const text = (v: string): MdNode => ({ t: "text", v });

test("markdownToNodes: bold, link and text come out as nodes, with the text unescaped", () => {
  assert.deepEqual(markdownToNodes("**Hi** & [x](https://a.com)"), [{ t: "b", c: [text("Hi")] }, text(" & "), { t: "a", href: "https://a.com", c: [text("x")] }]);
});

test("markdownToNodes: a bare URL is a link node; a heading is a bold node; a list is bullet text", () => {
  assert.deepEqual(markdownToNodes("see https://a.com/x"), [text("see "), { t: "a", href: "https://a.com/x", c: [text("https://a.com/x")] }]);
  assert.deepEqual(markdownToNodes("# T"), [{ t: "b", c: [text("T")] }]);
  assert.deepEqual(markdownToNodes("- one"), [text("• one")]);
});

test("markdownToNodes: pre blocks and code keep their text literally", () => {
  assert.deepEqual(markdownToNodes("`a<b`"), [{ t: "code", c: [text("a<b")] }]);
  assert.deepEqual(markdownToNodes("```\n<x>\n```"), [{ t: "pre", c: [text("\n<x>\n")] }]);
});

test("markdownToNodes: hostile input yields text nodes and only http(s) links", () => {
  const nodes = markdownToNodes('<script>alert(1)</script> [x](javascript:alert(1)) [y](https://ok.com)');
  const flat = JSON.stringify(nodes);
  const links = nodes.filter((n): n is Extract<MdNode, { t: "a" }> => n.t === "a");
  assert.deepEqual(links.map((n) => n.href), ["https://ok.com"]);
  assert.ok(nodes.every((n) => ["text", "a", "b", "i", "code", "pre"].includes(n.t)));
  assert.match(flat, /<script>alert\(1\)<\/script>/, "shown as text, not dropped");
});
