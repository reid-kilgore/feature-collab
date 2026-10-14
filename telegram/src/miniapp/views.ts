// What the Mini App is allowed to see: open batches only, and only the fields a card shows.
// Nothing here carries the bot token, a chat id, a message id, or any batch that is finished.

import path from "node:path";
import type { Store, BatchRow, QuestionRow } from "../core/store.ts";
import type { AskPayload, Question } from "../contract/payload.ts";
import { isBatchTimedOut } from "../core/interaction.ts";

export interface ListItem {
  id: string;
  title: string;
  asker: string;
  createdAt: string;
  timeoutAt: string | null;
  total: number;
  done: number;
}

export interface ListView {
  readAt: string;
  batches: ListItem[];
}

export type QuestionState = "open" | "answered" | "skipped" | "closed";

export interface OptionView {
  value: string;
  label: string;
  description?: string;
  recommended: boolean;
}

export interface QuestionView {
  id: string;
  prompt: string;
  type: Question["type"];
  options: OptionView[];
  allowOther: boolean;
  skippable: boolean;
  placeholder?: string;
  state: QuestionState;
  // What is already chosen in chat for an open multiple-choice question.
  preselected: string[];
  // A short description of the answer, for a question that is not open.
  answerText?: string;
}

export interface DetailView extends ListItem {
  message?: string;
  readAt: string;
  questions: QuestionView[];
}

const RECOMMENDED = /^\(recommended\)\s*/i;

function optionView(o: { value: string; label: string; description?: string }): OptionView {
  const recommended = RECOMMENDED.test(o.label);
  const label = recommended ? o.label.replace(RECOMMENDED, "") : o.label;
  return { value: o.value, label, ...(o.description ? { description: o.description } : {}), recommended };
}

function askerLabel(batch: BatchRow): string {
  return batch.asker_tmux_window || batch.asker_path;
}

function listItem(batch: BatchRow, payload: AskPayload, rows: QuestionRow[]): ListItem {
  const title = payload.title || payload.questions[0]?.prompt.slice(0, 80) || path.basename(batch.asker_path);
  return {
    id: batch.id,
    title,
    asker: askerLabel(batch),
    createdAt: batch.created_at,
    timeoutAt: batch.timeout_at,
    total: payload.questions.length,
    done: rows.filter((r) => r.status === "answered" || r.status === "skipped").length,
  };
}

function isOpenBatch(batch: BatchRow, now: Date): boolean {
  return batch.status === "pending" && !isBatchTimedOut(batch, now);
}

export function listView(store: Store, now: Date = new Date()): ListView {
  const batches = store
    .listPendingBatches()
    .filter((b) => isOpenBatch(b, now))
    .reverse()
    .map((b) => listItem(b, JSON.parse(b.payload_json) as AskPayload, store.listQuestionsForBatch(b.id)));
  return { readAt: now.toISOString(), batches };
}

function describeAnswer(question: Question, row: QuestionRow): string | undefined {
  if (row.status === "skipped") return "Skipped";
  if (row.status !== "answered") return undefined;
  if (question.type === "text") return row.text_answer ?? undefined;
  const selected = row.selected_json ? (JSON.parse(row.selected_json) as string[]) : [];
  return selected.map((v) => optionView(question.options?.find((o) => o.value === v) ?? { value: v, label: v }).label).join(", ");
}

export function detailView(store: Store, batchId: string, now: Date = new Date()): DetailView | undefined {
  const batch = store.getBatch(batchId);
  if (!batch || !isOpenBatch(batch, now)) return undefined;
  const payload = JSON.parse(batch.payload_json) as AskPayload;
  const rows = store.listQuestionsForBatch(batchId);
  const questions: QuestionView[] = payload.questions.map((q, idx) => {
    const row = rows.find((r) => r.idx === idx);
    const status = row?.status ?? "closed";
    const state: QuestionState =
      status === "waiting" || status === "pending" || status === "awaiting_text"
        ? "open"
        : status === "answered"
          ? "answered"
          : status === "skipped"
            ? "skipped"
            : "closed";
    const preselected = state === "open" && q.type === "multiple" && row?.selected_json ? (JSON.parse(row.selected_json) as string[]) : [];
    const answerText = row ? describeAnswer(q, row) : undefined;
    return {
      id: q.id,
      prompt: q.prompt,
      type: q.type,
      options: (q.options ?? []).map(optionView),
      allowOther: q.type !== "text" && q.allowOther !== false,
      skippable: q.required === false,
      ...(q.placeholder ? { placeholder: q.placeholder } : {}),
      state,
      preselected,
      ...(answerText !== undefined ? { answerText } : {}),
    };
  });
  return { ...listItem(batch, payload, rows), ...(payload.message ? { message: payload.message } : {}), readAt: now.toISOString(), questions };
}
