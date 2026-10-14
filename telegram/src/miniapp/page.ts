// The static page shell. It holds no data: everything comes from the /api routes, which need
// valid Telegram initData. The files are read once at startup.

import { readFileSync } from "node:fs";

function load(name: string): string {
  return readFileSync(new URL(`./web/${name}`, import.meta.url), "utf8");
}

export const PAGE_HTML = load("index.html");
export const PAGE_JS = load("app.js");
export const PAGE_CSS = load("app.css");
