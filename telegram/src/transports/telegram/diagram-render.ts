// Renders a mermaid or svg diagram to a PNG with a headless Chromium. No mmdc or
// rsvg-convert is needed. The Chromium binary comes from TG_CHROMIUM, else the newest
// Playwright cache install. Mermaid is loaded from the same pinned CDN URL ask-questions
// uses. Mermaid is first run in a page to get its SVG (dump-dom), then the SVG is
// screenshotted from a static page, so a mermaid syntax error is detected instead of
// being photographed.

import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DiagramKind } from "../../core/diagrams.ts";

export const MERMAID_URL = "https://cdn.jsdelivr.net/npm/mermaid@12.1.0/dist/mermaid.esm.min.mjs";
const WINDOW = "1400,1000";
const RUN_TIMEOUT_MS = 60_000;

export type DiagramRenderer = (kind: DiagramKind, source: string) => Promise<string>;

function numericDesc(a: string, b: string): number {
  const na = Number(/(\d+)$/.exec(a)?.[1] ?? 0);
  const nb = Number(/(\d+)$/.exec(b)?.[1] ?? 0);
  return nb - na;
}

export function findChromium(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string {
  if (env.TG_CHROMIUM) {
    if (!existsSync(env.TG_CHROMIUM)) throw new Error(`TG_CHROMIUM is set to ${env.TG_CHROMIUM}, which does not exist`);
    return env.TG_CHROMIUM;
  }
  const cache = env.PLAYWRIGHT_BROWSERS_PATH || path.join(home, "Library", "Caches", "ms-playwright");
  if (!existsSync(cache)) throw new Error(`no Chromium found: ${cache} does not exist and TG_CHROMIUM is not set`);
  const entries = readdirSync(cache);
  const pick = (prefix: string) => entries.filter((e) => e.startsWith(prefix)).sort(numericDesc);
  // The headless shell first (it is what dump-dom and screenshot are built for), then full
  // Chromium; newest build of each first.
  const candidates: string[] = [];
  for (const dir of pick("chromium_headless_shell-")) {
    for (const sub of ["chrome-headless-shell-mac-arm64", "chrome-headless-shell-mac-x64", "chrome-headless-shell-linux"]) {
      candidates.push(path.join(cache, dir, sub, "chrome-headless-shell"));
    }
  }
  for (const dir of pick("chromium-")) {
    for (const sub of ["chrome-mac-arm64", "chrome-mac"]) {
      candidates.push(path.join(cache, dir, sub, "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"));
      candidates.push(path.join(cache, dir, sub, "Chromium.app", "Contents", "MacOS", "Chromium"));
    }
    candidates.push(path.join(cache, dir, "chrome-linux", "chrome"));
  }
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error(`no Chromium binary found under ${cache} and TG_CHROMIUM is not set`);
  return found;
}

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: RUN_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`Chromium failed: ${error.message}${stderr ? ` (${stderr.trim().slice(-300)})` : ""}`));
      else resolve(stdout);
    });
  });
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function browserArgs(profile: string): string[] {
  return ["--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", `--user-data-dir=${profile}`, `--window-size=${WINDOW}`];
}

const PAGE_STYLE = `html,body{margin:0;background:#fff}body{padding:16px;box-sizing:border-box;width:100vw;height:100vh;display:flex;align-items:center;justify-content:center}
svg,img{max-width:100%;max-height:100%}
body>svg,#tg-ok,#tg-ok>svg{width:100%;height:100%;max-width:none!important}`;

function mermaidPage(source: string): string {
  return `<!doctype html><meta charset="utf-8"><body><pre id="src" hidden>${escapeHtml(source)}</pre><div id="out"></div>
<script type="module">
import mermaid from "${MERMAID_URL}";
const out = document.getElementById("out");
try {
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
  const { svg } = await mermaid.render("tgdiagram", document.getElementById("src").textContent);
  const ok = document.createElement("div");
  ok.id = "tg-ok";
  ok.innerHTML = svg;
  out.appendChild(ok);
} catch (e) {
  const fail = document.createElement("div");
  fail.id = "tg-fail";
  fail.textContent = String((e && e.message) || e) || "unknown mermaid error";
  out.appendChild(fail);
}
</script>`;
}

export const renderDiagramToPng: DiagramRenderer = async (kind, source) => {
  const chromium = findChromium();
  const dir = mkdtempSync(path.join(os.tmpdir(), "agent-telegram-diagram-"));
  try {
    const profile = path.join(dir, "profile");
    let body: string;
    if (kind === "mermaid") {
      const pageFile = path.join(dir, "mermaid.html");
      writeFileSync(pageFile, mermaidPage(source));
      const dom = await run(chromium, [...browserArgs(profile), "--virtual-time-budget=20000", "--dump-dom", `file://${pageFile}`]);
      const body0 = dom.slice(dom.indexOf('<div id="out">'));
      const fail = /<div id="tg-fail">([\s\S]*?)<\/div>/.exec(body0);
      if (fail) throw new Error(`mermaid could not render the diagram: ${(fail[1] ?? "").replace(/<[^>]+>/g, "").slice(0, 300)}`);
      const ok = /<div id="tg-ok">([\s\S]*<\/svg>)/.exec(body0);
      if (!ok) throw new Error("mermaid produced no output (is the CDN reachable?)");
      body = `<div id="tg-ok">${ok[1]!}`;
    } else {
      // Raw svg goes in as an <img> data URI: an image cannot run scripts or load resources.
      body = `<img src="data:image/svg+xml;base64,${Buffer.from(source, "utf8").toString("base64")}" style="width:100%;height:100%;object-fit:contain">`;
    }
    const staticPage = path.join(dir, "shot.html");
    writeFileSync(staticPage, `<!doctype html><meta charset="utf-8"><style>${PAGE_STYLE}</style><body>${body}</body>`);
    const png = path.join(dir, "diagram.png");
    await run(chromium, [...browserArgs(profile), "--virtual-time-budget=5000", `--screenshot=${png}`, `file://${staticPage}`]);
    if (!existsSync(png) || statSync(png).size === 0) throw new Error("Chromium wrote no screenshot");
    // Move the PNG out of the work dir so the caller owns it.
    const out = path.join(os.tmpdir(), `agent-telegram-diagram-${process.pid}-${Date.now()}.png`);
    writeFileSync(out, readFileSync(png));
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
