// Helpers for Mini App tests: signing initData the way Telegram does, and a store with batches.

import { createHmac } from "node:crypto";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store, newId, newShortId } from "../../src/core/store.ts";
import type { QuestionStatus } from "../../src/core/store.ts";
import type { OutboundPort } from "../../src/core/interaction.ts";
import type { AskPayload } from "../../src/contract/payload.ts";

export const TEST_BOT_TOKEN = "123456789:AAtestTokenForMiniAppTestsOnly_0123456789";

export function signInitData(fields: Record<string, string>, botToken = TEST_BOT_TOKEN): string {
  const dataCheckString = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secret).update(dataCheckString).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

export function initDataFor(userId: number, authDate: number, extra: Record<string, string> = {}, botToken = TEST_BOT_TOKEN): string {
  return signInitData({ auth_date: String(authDate), query_id: "AAHtest", user: JSON.stringify({ id: userId, first_name: "Reid" }), ...extra }, botToken);
}

export interface FakePort extends OutboundPort {
  sentQuestions: number;
  sentIndexes: number[];
  resolvedViews: string[];
  deletedForceReplies: number;
  done: boolean;
  failNextSend: boolean;
  sends: Array<{ index: number; replyTo?: number; messageId: number; forceReplyMessageId?: number }>;
  moved: Array<{ oldMessageId: number; oldForceReplyMessageId: number | null }>;
  retracted: number[];
  // Runs inside sendQuestion, to simulate something happening while the message is being sent.
  duringSend?: () => void | Promise<void>;
}

export function makeFakePort(): FakePort {
  const port: FakePort = {
    sentQuestions: 0,
    sentIndexes: [],
    resolvedViews: [],
    deletedForceReplies: 0,
    done: false,
    failNextSend: false,
    sends: [],
    moved: [],
    retracted: [],
    async sendHeader() {},
    async sendQuestion(_batch, question, _row, index, _total, _selected, opts) {
      if (port.failNextSend) {
        port.failNextSend = false;
        throw new Error("telegram down");
      }
      port.sentQuestions++;
      port.sentIndexes.push(index);
      const sent: { messageId: number; forceReplyMessageId?: number } = { messageId: 100 + port.sentQuestions };
      if (question.type === "text") sent.forceReplyMessageId = 500 + port.sentQuestions;
      port.sends.push({ index, replyTo: opts?.replyToMessageId, ...sent });
      await port.duringSend?.();
      return sent;
    },
    async markMoved(_batch, _question, oldMessageId, oldForceReplyMessageId) {
      port.moved.push({ oldMessageId, oldForceReplyMessageId });
    },
    async retract(_batch, messageId) {
      port.retracted.push(messageId);
    },
    async editResolved(_batch, _question, _row, kind, text) {
      port.resolvedViews.push(`${kind}:${text ?? ""}`);
    },
    async deleteForceReply() {
      port.deletedForceReplies++;
    },
    async sendBatchDone() {
      port.done = true;
    },
  };
  return port;
}

export function makeStore(): Store {
  const dir = mkdtempSync(path.join(os.tmpdir(), "agent-telegram-miniapp-test-"));
  return new Store(path.join(dir, "state.sqlite"));
}

export function createBatch(store: Store, payload: AskPayload, opts: { timeoutAt?: string; tmuxWindow?: string } = {}): string {
  const id = newId();
  store.createBatch({
    id,
    status: "pending",
    asker_path: "/tmp/project",
    asker_tmux_window: opts.tmuxWindow ?? null,
    payload_json: JSON.stringify(payload),
    timeout_at: opts.timeoutAt ?? null,
    on_timeout: "cancel",
    chat_id: "1",
    user_id: "1",
  });
  payload.questions.forEach((_q, idx) => {
    store.createQuestion({
      id: newId(),
      batch_id: id,
      idx,
      short_id: newShortId(),
      status: "waiting" as QuestionStatus,
      selected_json: null,
      text_answer: null,
      message_id: null,
      force_reply_message_id: null,
    });
  });
  return id;
}

export const THREE_QUESTIONS: AskPayload = {
  version: 1,
  title: "Pick a plan",
  questions: [
    { id: "q1", prompt: "Which database?", type: "single", options: [{ value: "pg", label: "(Recommended) Postgres" }, { value: "sqlite", label: "SQLite" }] },
    { id: "q2", prompt: "Which regions?", type: "multiple", options: [{ value: "us", label: "US" }, { value: "eu", label: "EU" }, { value: "ap", label: "AP" }] },
    { id: "q3", prompt: "Anything else?", type: "text", required: false },
  ],
};
