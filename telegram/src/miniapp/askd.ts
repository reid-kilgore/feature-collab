// askd is the source of truth for what is waiting for Reid. This reads its list of open question sets
// (GET /api/sets?state=open) so the Mini App can show every one of them, including sets that have no
// live batch here (a quiz, a link-only set, a set whose send failed).
// The address comes from configuration (see resolveAskdUrl in ../config.ts); no host name is in this file.

export interface AskdSet {
  id: string;
  title: string;
  // Where the set's form lives. Always an http(s) URL.
  url: string;
  asker: string;
  createdAt: string;
  expiresAt: string | null;
  questions: number;
}

export type AskdSource = () => Promise<AskdSet[] | undefined>;

const SET_ID = /^[0-9a-f]{12}$/;

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function httpUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : undefined;
  } catch {
    return undefined;
  }
}

// Reads askd's list. A row that does not look like an open set is dropped, never guessed at.
export function parseAskdSets(body: unknown): AskdSet[] | undefined {
  if (!Array.isArray(body)) return undefined;
  const out: AskdSet[] = [];
  for (const row of body) {
    if (row === null || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const url = httpUrl(r.url);
    if (typeof r.id !== "string" || !SET_ID.test(r.id) || !url || r.state !== "open") continue;
    const asker = (r.asker ?? {}) as Record<string, unknown>;
    out.push({
      id: r.id,
      title: str(r.title) || "(untitled)",
      url,
      asker: str(asker.tmux) || str(asker.session),
      createdAt: str(r.createdAt),
      expiresAt: str(r.expiresAt) || null,
      questions: typeof r.questions === "number" && Number.isFinite(r.questions) ? r.questions : 0,
    });
  }
  return out;
}

// Returns undefined when askd cannot be reached or answers badly: the caller then shows only its own batches.
export async function fetchAskdSets(baseUrl: string, opts: { fetch?: typeof fetch; timeoutMs?: number } = {}): Promise<AskdSet[] | undefined> {
  const doFetch = opts.fetch ?? fetch;
  try {
    const res = await doFetch(`${baseUrl.replace(/\/+$/, "")}/api/sets?state=open`, { signal: AbortSignal.timeout(opts.timeoutMs ?? 2000) });
    if (!res.ok) return undefined;
    return parseAskdSets(await res.json());
  } catch {
    return undefined;
  }
}

// ---- answering an askd set in the app ----
// A set with no live batch here (a quiz above all) is answered through three askd routes. askd keeps the quiz key: the view has
// no answer, and a verdict comes back only after a pick, which askd locks. This only forwards; it grades nothing.

export interface AskdReply {
  status: number;
  body: unknown;
}

export interface AskdAnswering {
  view(setId: string): Promise<AskdReply>;
  check(setId: string, body: { questionId: string; value: string }): Promise<AskdReply>;
  submit(setId: string, body: { answers: MiniAnswer[]; annotations: Record<string, never> }): Promise<AskdReply>;
}

export interface MiniAnswer {
  questionId: string;
  value: string | string[] | null;
  notes: string;
  disagree?: boolean;
}

export function isSetId(value: string): boolean {
  return SET_ID.test(value);
}

export function createAskdAnswering(baseUrl: string, opts: { fetch?: typeof fetch; timeoutMs?: number } = {}): AskdAnswering {
  const doFetch = opts.fetch ?? fetch;
  const root = baseUrl.replace(/\/+$/, "");
  async function call(setId: string, op: string, body?: unknown): Promise<AskdReply> {
    if (!SET_ID.test(setId)) return { status: 404, body: { error: "not_found" } };
    try {
      const res = await doFetch(`${root}/sets/${setId}/api/${op}`, {
        method: body === undefined ? "GET" : "POST",
        headers: body === undefined ? {} : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10000),
      });
      let parsed: unknown = {};
      try {
        parsed = await res.json();
      } catch { /* an empty or odd body: the status says enough */ }
      return { status: res.status, body: parsed };
    } catch {
      return { status: 502, body: { error: "askd_unreachable" } };
    }
  }
  return {
    view: (setId) => call(setId, "mini"),
    check: (setId, body) => call(setId, "mini-check", body),
    submit: (setId, body) => call(setId, "mini-submit", body),
  };
}
