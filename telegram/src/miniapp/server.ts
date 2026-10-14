// HTTP server for the Telegram Mini App. It runs inside the daemon (only the daemon can resolve
// a waiting `tg ask` caller) and is isolated from it:
//   - it is created only when the config asks for it, and binds 127.0.0.1 only (Tailscale
//     Funnel on the same machine is what makes it reachable);
//   - no error inside a request handler escapes: it becomes a bare 500, never a crash;
//   - every /api route needs valid Telegram initData (see initdata.ts); a failure is a bare 401.
// The page shell (HTML, JS, CSS) is public and holds no data.

import http from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Store } from "../core/store.ts";
import type { OutboundPort, OnResolved } from "../core/interaction.ts";
import { applyBatchAnswers } from "../core/answers.ts";
import type { Submission } from "../core/answers.ts";
import { validateInitData } from "./initdata.ts";
import { listView, detailView } from "./views.ts";
import { PAGE_HTML, PAGE_JS, PAGE_CSS } from "./page.ts";

export interface MiniappServerDeps {
  store: Store;
  port: OutboundPort;
  onResolved: OnResolved;
  botToken: string;
  allowedUserId: string;
  // First path segment of every URL; a random string, so the public URL is not guessable.
  secret: string;
  maxAgeSeconds: number;
  log: (line: string) => void;
}

const MAX_BODY_BYTES = 64 * 1024;
const MAX_SUBMISSIONS = 100;
// The payload contract sets no limit on question ids; this only bounds what one request carries.
const MAX_ID_LENGTH = 1000;
const MAX_CONNECTIONS = 64;
const BATCH_ID = /^[0-9a-f]{24}$/;

const CSP = [
  "default-src 'none'",
  "script-src 'self' https://telegram.org",
  "style-src 'self'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors https://web.telegram.org https://webk.telegram.org https://webz.telegram.org",
].join("; ");

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function sameSecret(given: string, expected: string): boolean {
  return timingSafeEqual(digest(given), digest(expected));
}

function send(res: http.ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...headers,
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendJson(res: http.ServerResponse, status: number, value: unknown): void {
  send(res, status, JSON.stringify(value), { "content-type": "application/json; charset=utf-8" });
}

class BodyTooLarge extends Error {}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (tooLarge) return;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        reject(new BodyTooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// Strict parse of the request body. Anything unexpected is a 400, never a guess.
export function parseSubmissions(raw: string): Submission[] | undefined {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const answers = (body as { answers?: unknown } | null)?.answers;
  if (!Array.isArray(answers) || answers.length === 0 || answers.length > MAX_SUBMISSIONS) return undefined;
  const out: Submission[] = [];
  for (const item of answers) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return undefined;
    const a = item as Record<string, unknown>;
    if (typeof a.questionId !== "string" || a.questionId.length === 0 || a.questionId.length > MAX_ID_LENGTH) return undefined;
    const sub: Submission = { questionId: a.questionId };
    if (a.selected !== undefined) {
      if (!Array.isArray(a.selected) || a.selected.length > 200 || a.selected.some((v) => typeof v !== "string")) return undefined;
      sub.selected = a.selected as string[];
    }
    if (a.other !== undefined) {
      if (typeof a.other !== "string") return undefined;
      sub.other = a.other;
    }
    if (a.text !== undefined) {
      if (typeof a.text !== "string") return undefined;
      sub.text = a.text;
    }
    if (a.skip !== undefined) {
      if (typeof a.skip !== "boolean") return undefined;
      sub.skip = a.skip;
    }
    out.push(sub);
  }
  return out;
}

export function createMiniappServer(deps: MiniappServerDeps): http.Server {
  const prefix = `/${deps.secret}`;

  async function route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // Parse by hand: new URL("//") throws, and an unauthenticated request must not reach the log.
    const rawUrl = req.url ?? "/";
    const queryAt = rawUrl.indexOf("?");
    const pathname = queryAt === -1 ? rawUrl : rawUrl.slice(0, queryAt);
    const firstSlash = pathname.indexOf("/", 1);
    const head = firstSlash === -1 ? pathname : pathname.slice(0, firstSlash);
    if (!pathname.startsWith("/") || pathname.startsWith("//") || !sameSecret(head, prefix)) return send(res, 404, "");
    if (firstSlash === -1) return send(res, 308, "", { location: `${prefix}/` });
    const rest = pathname.slice(firstSlash);

    if (rest === "/" || rest === "/app.js" || rest === "/app.css") {
      if (req.method !== "GET") return send(res, 405, "");
      if (rest === "/") return send(res, 200, PAGE_HTML, { "content-type": "text/html; charset=utf-8", "content-security-policy": CSP });
      if (rest === "/app.js") return send(res, 200, PAGE_JS, { "content-type": "text/javascript; charset=utf-8" });
      return send(res, 200, PAGE_CSS, { "content-type": "text/css; charset=utf-8" });
    }

    const apiMatch = /^\/api\/batches(?:\/([^/]+)(\/answers)?)?$/.exec(rest);
    if (!apiMatch) return send(res, 404, "");

    const auth = validateInitData(headerValue(req.headers["x-telegram-init-data"]), {
      botToken: deps.botToken,
      allowedUserId: deps.allowedUserId,
      maxAgeSeconds: deps.maxAgeSeconds,
    });
    if (!auth.ok) return send(res, 401, "");

    const batchId = apiMatch[1];
    const isAnswers = apiMatch[2] !== undefined;
    if (batchId === undefined) {
      if (req.method !== "GET") return send(res, 405, "");
      return sendJson(res, 200, listView(deps.store));
    }
    if (!BATCH_ID.test(batchId)) return sendJson(res, 404, { error: "not_found" });

    if (!isAnswers) {
      if (req.method !== "GET") return send(res, 405, "");
      const detail = detailView(deps.store, batchId);
      return detail ? sendJson(res, 200, detail) : sendJson(res, 404, { error: "not_found" });
    }

    if (req.method !== "POST") return send(res, 405, "");
    const contentType = headerValue(req.headers["content-type"]) ?? "";
    if (!contentType.toLowerCase().startsWith("application/json")) return sendJson(res, 415, { error: "bad_request" });
    let raw: string;
    try {
      raw = await readBody(req);
    } catch (error) {
      res.setHeader("connection", "close");
      return sendJson(res, error instanceof BodyTooLarge ? 413 : 400, { error: "bad_request" });
    }
    const submissions = parseSubmissions(raw);
    if (!submissions) return sendJson(res, 400, { error: "bad_request" });
    const outcome = await applyBatchAnswers(deps.store, deps.port, deps.onResolved, batchId, submissions);
    if (outcome.batchStatus === "unknown") return sendJson(res, 404, { error: "not_found" });
    return sendJson(res, 200, outcome);
  }

  // connectionsCheckingInterval: how often timed-out requests and idle sockets are swept.
  const server = http.createServer({ connectionsCheckingInterval: 2000 }, (req, res) => {
    route(req, res).catch((error) => {
      deps.log(`miniapp request error: ${(error as Error).message}`);
      if (!res.headersSent) send(res, 500, "");
      else res.destroy();
    });
  });
  server.on("error", (error) => deps.log(`miniapp server error: ${error.message}`));
  server.on("clientError", (_error, socket) => socket.destroy());
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  // Funnel accepts TCP before any path check, so cap sockets: the poller shares this process's
  // file descriptors. Idle and half-open connections are dropped within a few seconds.
  server.maxConnections = MAX_CONNECTIONS;
  return server;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Listens on loopback only. Resolves to the bound port; rejects if the port cannot be bound
// (the caller logs that and carries on without the Mini App).
export function listenLoopback(server: http.Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : port);
    });
  });
}
