// The skill and README are read by whoever installs this tool, not only by its maintainer. They talk about
// "the user" and "the person", use no gendered pronoun for them, and name no person, machine or private path.
// A tool only the maintainer has (ask-questions) may appear only in a section headed "Optional".

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILES = ["README.md", "skill/SKILL.md", "skill/AGENTS-snippet.md", "skill/dispatcher/SKILL.md"];
// The setup guide, once it is in the tree, is held to the same rule.
if (existsSync(path.join(root, "docs/SETUP-GUIDE.md"))) FILES.push("docs/SETUP-GUIDE.md");

function read(file: string): string {
  return readFileSync(path.join(root, file), "utf8");
}

// Text outside fenced code blocks, so a JSON example cannot trip a prose check.
function prose(text: string): string {
  return text.replace(/```[\s\S]*?```/g, "");
}

for (const file of FILES) {
  test(`${file} names no person, machine or private path`, () => {
    const text = read(file);
    for (const forbidden of [/\breid\b/i, /\bredd\b/i, /\bmason\b/i, /\bmbp\b/, /\bduo\b/i, /escape-from/i, /passcom/i, /\/Users\//, /\.maestro/i, /\bmaestro\b/i]) {
      assert.doesNotMatch(text, forbidden);
    }
  });

  test(`${file} uses no gendered pronoun for the user`, () => {
    const text = prose(read(file)).replace(/`[^`\n]*`/g, "");
    const found = text.match(/\b(he|him|his|himself|she|her|hers|herself)\b/gi);
    assert.equal(found, null, `gendered pronouns found: ${found?.join(", ")}`);
  });
}

test("ask-questions appears only in a section headed Optional", () => {
  for (const file of FILES) {
    const sections = read(file).split(/^## /m);
    for (const section of sections) {
      if (/ask-questions/.test(section)) assert.match(section, /^Optional/, `${file}: ask-questions outside an Optional section`);
    }
  }
});

test("skill/SKILL.md documents the tg ask payload itself, so it needs no other tool's help", () => {
  const text = read("skill/SKILL.md");
  assert.match(text, /## Payload reference/);
  for (const needle of [/"single"/, /"multiple"/, /"text"/, /`allowOther`/, /`default`/, /`required`/, /`options`/, /`documents`/, /`answers\.<id>\.value`/]) {
    assert.match(text.slice(text.indexOf("## Payload reference")), needle);
  }
});

test("the skill description does not name a person", () => {
  const description = /^description: (.*)$/m.exec(read("skill/SKILL.md"))![1]!;
  assert.match(description, /the user|the person/);
});
