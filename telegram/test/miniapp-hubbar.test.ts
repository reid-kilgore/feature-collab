// The Mini App's top bar: three links to the tailnet hub, opened in the phone's browser.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPage } from "./support/fake-dom.ts";
import { resolveHubUrl, DEFAULT_HUB_URL } from "../src/config.ts";
import type { Config } from "../src/config.ts";

const HUB = "https://hub.example.ts.net:8443";
const routes = { "GET batches": { body: { readAt: "2026-10-14T23:00:00Z", batches: [] } } };

function links(t: ReturnType<typeof loadPage>) {
  return t.doc.hubbar.find((n) => n.tagName === "A");
}

test("the bar has Questions, Threads and Work links pointing at the hub", () => {
  const t = loadPage({ nativeBack: true, routes, hub: HUB });
  assert.deepEqual(links(t).map((a) => [a.textContent, a.attrs.href]), [
    ["Questions", `${HUB}/`],
    ["Threads", `${HUB}/threads`],
    ["Work", `${HUB}/#work-wip`],
  ]);
  assert.match(t.doc.hubbar.textContent, /Opens in your browser; needs Tailscale on/);
});

test("inside Telegram a tap goes through openLink; without it the plain link is left alone", () => {
  const inTg = loadPage({ nativeBack: true, routes, hub: HUB, openLink: true });
  const ev = inTg.doc.fire(links(inTg)[1]!, "click");
  assert.equal(ev.defaultPrevented, true);
  assert.ok(inTg.calls.includes(`openLink ${HUB}/threads`));
  const plain = loadPage({ nativeBack: true, routes, hub: HUB, openLink: false });
  const ev2 = plain.doc.fire(links(plain)[2]!, "click");
  assert.equal(ev2.defaultPrevented, false);
  assert.ok(!plain.calls.some((c) => c.startsWith("openLink")));
});

test("the hint is dismissible and stays dismissed", () => {
  const storage = new Map<string, string>();
  const first = loadPage({ nativeBack: true, routes, hub: HUB, storage });
  const close = first.doc.hubbar.find((n) => n.tagName === "BUTTON")[0]!;
  first.doc.fire(close, "click");
  assert.doesNotMatch(first.doc.hubbar.textContent, /Tailscale/);
  assert.equal(links(first).length, 3, "the links stay");
  const second = loadPage({ nativeBack: true, routes, hub: HUB, storage });
  assert.doesNotMatch(second.doc.hubbar.textContent, /Tailscale/);
});

test("with no hub address (or the unfilled placeholder) the bar draws nothing", () => {
  assert.equal(links(loadPage({ nativeBack: true, routes })).length, 0);
  assert.equal(links(loadPage({ nativeBack: true, routes, hub: "__HUB_URL__" })).length, 0);
});

test("the hub address comes from HUB_URL, then config, then the default; junk falls through", () => {
  const cfg = (hubUrl?: string) => ({ chatId: "1", userId: "1", botUsername: "b", miniapp: { port: 1, secret: "x", publicUrl: "https://a", hubUrl } }) as Config;
  assert.equal(resolveHubUrl(cfg("https://c.ts.net:1/x"), { HUB_URL: "https://e.ts.net:2/path" }), "https://e.ts.net:2");
  assert.equal(resolveHubUrl(cfg("https://c.ts.net:1/x"), {}), "https://c.ts.net:1");
  assert.equal(resolveHubUrl(cfg("javascript:alert(1)"), { HUB_URL: "nope" }), DEFAULT_HUB_URL);
  assert.equal(resolveHubUrl({ chatId: "1", userId: "1", botUsername: "b" }, {}), DEFAULT_HUB_URL);
});
