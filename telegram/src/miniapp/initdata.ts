// Validation of Telegram Mini App initData, per
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
//
// The Mini App page is served over a public HTTPS URL (Tailscale Funnel), so this check is the
// only lock on the data API. It is deliberately strict and returns no detail to the caller:
// the reason is for tests and logs, never for the HTTP response.

import { createHmac, timingSafeEqual } from "node:crypto";

export interface InitDataOptions {
  botToken: string;
  allowedUserId: string;
  maxAgeSeconds: number;
  // Injectable clock, in milliseconds, for tests.
  nowMs?: number;
}

export type InitDataResult = { ok: true; userId: string; authDate: number } | { ok: false; reason: string };

const MAX_INIT_DATA_LENGTH = 4096;
// auth_date from the future by more than this is clock skew we do not accept.
const MAX_FUTURE_SKEW_SECONDS = 60;

export function validateInitData(initData: string | undefined, opts: InitDataOptions): InitDataResult {
  if (!initData || initData.length > MAX_INIT_DATA_LENGTH) return { ok: false, reason: "missing or oversized" };
  const params = new URLSearchParams(initData);
  const seen = new Set<string>();
  for (const key of params.keys()) {
    if (seen.has(key)) return { ok: false, reason: "repeated field" };
    seen.add(key);
  }
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return { ok: false, reason: "bad hash format" };

  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(opts.botToken).digest();
  const expected = createHmac("sha256", secretKey).update(dataCheckString).digest();
  const given = Buffer.from(hash, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "hash mismatch" };

  const authDateRaw = params.get("auth_date");
  if (!authDateRaw || !/^\d{1,12}$/.test(authDateRaw)) return { ok: false, reason: "bad auth_date" };
  const authDate = Number(authDateRaw);
  const ageSeconds = (opts.nowMs ?? Date.now()) / 1000 - authDate;
  if (ageSeconds > opts.maxAgeSeconds) return { ok: false, reason: "expired" };
  if (ageSeconds < -MAX_FUTURE_SKEW_SECONDS) return { ok: false, reason: "from the future" };

  let user: unknown;
  try {
    user = JSON.parse(params.get("user") ?? "");
  } catch {
    return { ok: false, reason: "bad user field" };
  }
  const id = (user as { id?: unknown } | null)?.id;
  if (typeof id !== "number" || !Number.isSafeInteger(id)) return { ok: false, reason: "bad user id" };
  if (String(id) !== opts.allowedUserId) return { ok: false, reason: "user not allowed" };
  return { ok: true, userId: String(id), authDate };
}
