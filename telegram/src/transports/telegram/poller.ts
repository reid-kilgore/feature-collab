// getUpdates long-poll loop with offset persistence, backoff, and 409 (another poller
// already running for this bot) handling.

import type { Store } from "../../core/store.ts";
import { TelegramApi } from "./api.ts";
import type { HandlerContext, TgUpdate } from "./handler.ts";
import { handleUpdate } from "./handler.ts";

const OFFSET_KEY = "update_offset";
const POLL_TIMEOUT_SECONDS = 25;

export class Poller {
  private stopped = false;
  private loopPromise: Promise<void> | undefined;
  private store: Store;
  private api: TelegramApi;
  private ctx: HandlerContext;
  private log: (line: string) => void;
  // The in-flight getUpdates call, so stop() can abort a long poll immediately instead of
  // waiting out its up-to-25s server-side timeout.
  private currentAbort: AbortController | undefined;

  constructor(store: Store, api: TelegramApi, ctx: HandlerContext, log: (line: string) => void = () => {}) {
    this.store = store;
    this.api = api;
    this.ctx = ctx;
    this.log = log;
  }

  start(): void {
    this.stopped = false;
    this.loopPromise = this.loop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.currentAbort?.abort();
    await this.loopPromise;
  }

  private async loop(): Promise<void> {
    let backoffMs = 1000;
    while (!this.stopped) {
      const offsetRaw = this.store.getMeta(OFFSET_KEY);
      const offset = offsetRaw ? Number(offsetRaw) + 1 : 0;
      const abort = new AbortController();
      this.currentAbort = abort;
      try {
        const updates = (await this.api.getUpdates(offset, POLL_TIMEOUT_SECONDS, abort.signal)) as TgUpdate[];
        this.currentAbort = undefined;
        backoffMs = 1000;
        for (const update of updates) {
          if (this.stopped) break;
          await this.processUpdate(update);
        }
        // A real Telegram server blocks for up to POLL_TIMEOUT_SECONDS server-side, so an
        // empty result there already paced the loop. A test double that answers
        // immediately would otherwise spin this loop as fast as the event loop allows.
        if (updates.length === 0 && !this.stopped) await sleep(200);
      } catch (error) {
        this.currentAbort = undefined;
        if (this.stopped && (error as { name?: string }).name === "AbortError") break; // expected on shutdown
        const message = (error as Error).message ?? String(error);
        if (message.includes("409")) {
          this.log(`getUpdates conflict (another poller running for this bot): ${message}`);
        } else {
          this.log(`getUpdates error: ${message}`);
        }
        if (this.stopped) break;
        await sleep(backoffMs);
        backoffMs = Math.min(backoffMs * 2, 30000);
      }
    }
  }

  private async processUpdate(update: TgUpdate): Promise<void> {
    const lastOffsetRaw = this.store.getMeta(OFFSET_KEY);
    const lastOffset = lastOffsetRaw ? Number(lastOffsetRaw) : -1;
    if (update.update_id <= lastOffset) return; // dedupe
    try {
      await handleUpdate(this.ctx, update);
    } catch (error) {
      this.log(`error handling update ${update.update_id}: ${(error as Error).message}`);
    }
    this.store.setMeta(OFFSET_KEY, String(update.update_id));
    this.store.setMeta("last_update_at", String(Date.now()));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
