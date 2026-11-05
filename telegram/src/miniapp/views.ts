// What the Mini App is allowed to see: open batches only, and only the fields a card shows.
// Nothing here carries the bot token, a chat id, a message id, or any batch that is finished.

import { markdownToNodes } from "../core/markdown.ts";
import type { MdNode } from "../core/markdown.ts";
import path from "node:path";
import type { Store, BatchRow, QuestionRow } from "../core/store.ts";
import type { AskPayload, Question } from "../contract/payload.ts";
import { isBatchTimedOut } from "../core/interaction.ts";
import type { AskdSet } from "./askd.ts";

export interface ListItem {
  id: string;
  title: string;
  asker: string;
  createdAt: string;
  timeoutAt: string | null;
  total: number;
  done: number;
  // Only on a card for an askd set that has no live batch here: the form to open. Such a card cannot be answered in the app.
  url?: string;
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
  // The description as nodes (bold, links, code) for the page to build; see MdNode in core/markdown.ts.
  descriptionNodes?: MdNode[];
  recommended: boolean;
}

export interface QuestionView {
  id: string;
  prompt: string;
  promptNodes: MdNode[];
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
  messageNodes?: MdNode[];
  readAt: string;
  questions: QuestionView[];
}

const RECOMMENDED = /^\(recommended\)\s*/i;

function optionView(o: { value: string; label: string; description?: string }): OptionView {
  const recommended = RECOMMENDED.test(o.label);
  const label = recommended ? o.label.replace(RECOMMENDED, "") : o.label;
  return { value: o.value, label, ...(o.description ? { description: o.description, descriptionNodes: markdownToNodes(o.description) } : {}), recommended };
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

// The list when askd is the source of truth: askd's open sets in askd's order. A set with a live batch
// (the batch carries the key "askd-<set id>") is a normal card; any other set is a card with the form's url.
// A batch that askd does not own (an ordinary `tg ask`) is kept after them, so nothing disappears.
// A batch keyed to a set askd no longer lists as open is left out. askd undefined (unreachable): this
// application's own list, as before.
export function mergedListView(store: Store, askd: AskdSet[] | undefined, now: Date = new Date()): ListView {
  if (!askd) return listView(store, now);
  const open = store.listPendingBatches().filter((b) => isOpenBatch(b, now));
  const used = new Set<string>();
  const batches: ListItem[] = askd.map((set) => {
    const batch = open.find((b) => b.ask_key === `askd-${set.id}`);
    if (batch) {
      used.add(batch.id);
      return listItem(batch, JSON.parse(batch.payload_json) as AskPayload, store.listQuestionsForBatch(batch.id));
    }
    return { id: set.id, title: set.title, asker: set.asker, createdAt: set.createdAt, timeoutAt: set.expiresAt, total: set.questions, done: 0, url: set.url };
  });
  for (const b of open.slice().reverse()) {
    if (used.has(b.id) || (b.ask_key ?? "").startsWith("askd-")) continue;
    batches.push(listItem(b, JSON.parse(b.payload_json) as AskPayload, store.listQuestionsForBatch(b.id)));
  }
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
      promptNodes: markdownToNodes(q.prompt),
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
  return { ...listItem(batch, payload, rows), ...(payload.message ? { message: payload.message, messageNodes: markdownToNodes(payload.message) } : {}), readAt: now.toISOString(), questions };
}

// ---- askd sets: Markdown as nodes ----
//
// askd's view of a set (and the verdict of a quiz pick) carries plain Markdown text. askd is a Python program with
// no Markdown for the page, so this daemon adds the nodes on the way through, with the same converter the chat and
// the batch view use. The page builds its DOM from the nodes and never parses HTML. The original text stays beside
// each field as the fallback. askd's own fields are never removed or changed.

// The page cannot show a picture: its content security policy allows no image from another host, and askd's
// pictures (/img/...) are on askd, not here. An image in the text becomes its alt text, in brackets.
const IMAGE = /!\[([^\]\n]*)\]\([^)\n]*\)/g;

export function mdWithoutImages(text: string): MdNode[] {
  return markdownToNodes(text.replace(IMAGE, (_m, alt: string) => (alt.trim() ? `[image: ${alt.trim()}]` : "[image]")));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function withNodes(record: Record<string, unknown>, keys: Array<[string, string]>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...record };
  for (const [key, nodesKey] of keys) {
    const text = record[key];
    if (typeof text === "string" && text) out[nodesKey] = mdWithoutImages(text);
  }
  return out;
}

// A quiz verdict from askd's mini-check route (and each entry of a view's `picked`).
export function askdVerdictWithNodes(verdict: unknown): unknown {
  if (!isRecord(verdict)) return verdict;
  const out = withNodes(verdict, [["why", "whyNodes"], ["whyWrong", "whyWrongNodes"], ["cite", "citeNodes"]]);
  if (isRecord(verdict.whyWrongAll)) {
    const all: Record<string, MdNode[]> = Object.create(null);
    for (const [value, text] of Object.entries(verdict.whyWrongAll)) if (typeof text === "string" && text) all[value] = mdWithoutImages(text);
    out.whyWrongAllNodes = all;
  }
  return out;
}

// askd's view of an open set (GET /sets/<id>/api/mini): the message, each prompt, each option's label and description.
export function askdViewWithNodes(view: unknown): unknown {
  if (!isRecord(view)) return view;
  const out = withNodes(view, [["message", "messageNodes"]]);
  if (Array.isArray(view.questions)) {
    out.questions = view.questions.map((q) => {
      if (!isRecord(q)) return q;
      const question = withNodes(q, [["prompt", "promptNodes"]]);
      if (Array.isArray(q.options)) question.options = q.options.map((o) => (isRecord(o) ? withNodes(o, [["label", "labelNodes"], ["description", "descriptionNodes"]]) : o));
      return question;
    });
  }
  if (isRecord(view.picked)) {
    const picked: Record<string, unknown> = Object.create(null);
    for (const [id, verdict] of Object.entries(view.picked)) picked[id] = askdVerdictWithNodes(verdict);
    out.picked = picked;
  }
  return out;
}
