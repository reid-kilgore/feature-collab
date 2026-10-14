// A hung Telegram call must fail by itself, not block a batch's submit chain forever.

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { TelegramApi } from "../src/transports/telegram/api.ts";

test("a Bot API call that never answers rejects after the timeout", async () => {
  const sockets = new Set<import("node:net").Socket>();
  const server = http.createServer(() => {
    // never respond
  });
  server.on("connection", (s) => sockets.add(s));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const api = new TelegramApi("1:tok", `http://127.0.0.1:${(server.address() as AddressInfo).port}`, 150);
    const started = Date.now();
    await assert.rejects(() => api.sendMessage("1", "hi"), /timed out/);
    assert.ok(Date.now() - started < 3000);
  } finally {
    for (const s of sockets) s.destroy();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
