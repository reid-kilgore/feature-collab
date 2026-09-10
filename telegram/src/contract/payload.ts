// AskPayload / AskResult types and validation. This mirrors ask-questions v1
// (see ../../../ask-questions/lib/contract.js) field for field, extended with two
// optional top-level fields (timeoutSeconds, onTimeout) and one optional per-question
// field (default). An agent that knows ask-questions knows `tg ask`.

export type QuestionType = "single" | "multiple" | "text";
export type OnTimeout = "cancel" | "default";

export interface Option {
  value: string;
  label: string;
  description?: string;
}

export interface Question {
  id: string;
  prompt: string;
  type: QuestionType;
  required?: boolean;
  options?: Option[];
  allowOther?: boolean;
  placeholder?: string;
  default?: string | string[];
}

export interface DocumentInput {
  id: string;
  title: string;
  markdown?: string;
  path?: string;
}

export interface AskPayload {
  version: 1;
  title?: string;
  message?: string;
  questions: Question[];
  documents?: DocumentInput[];
  timeoutSeconds?: number;
  onTimeout?: OnTimeout;
}

export type AskStatus = "submitted" | "cancelled" | "expired";

export interface AnswerEntry {
  value: string | string[] | null;
  notes: string;
}

export interface AskResult {
  version: 1;
  status: AskStatus;
  askerPath: string;
  askerTmuxWindow?: string;
  answers: Record<string, AnswerEntry>;
  annotations: Record<string, never>;
  submittedAt?: string;
}

export class ContractError extends Error {
  issues: { location: string; message: string }[];
  constructor(message: string, issues: { location: string; message: string }[] = []) {
    super(message);
    this.name = "ContractError";
    this.issues = issues;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function issue(issues: { location: string; message: string }[], location: string, message: string): void {
  issues.push({ location, message });
}

function checkString(
  value: unknown,
  location: string,
  issues: { location: string; message: string }[],
  opts: { required?: boolean } = {},
): void {
  const required = opts.required ?? true;
  if (value === undefined && !required) return;
  if (typeof value !== "string" || value.length === 0) issue(issues, location, "must be a non-empty string");
}

const QUESTION_TYPES = new Set(["single", "multiple", "text"]);
const ON_TIMEOUT_VALUES = new Set(["cancel", "default"]);

export function validatePayload(payload: unknown): AskPayload {
  const issues: { location: string; message: string }[] = [];
  if (!isObject(payload)) {
    throw new ContractError("Input must be a JSON object.", [{ location: "payload", message: "must be an object" }]);
  }
  if (payload.version !== 1) issue(issues, "version", "must be 1");
  if (payload.title !== undefined) checkString(payload.title, "title", issues);
  if (payload.message !== undefined) checkString(payload.message, "message", issues);

  if (payload.timeoutSeconds !== undefined) {
    if (typeof payload.timeoutSeconds !== "number" || !Number.isFinite(payload.timeoutSeconds) || payload.timeoutSeconds <= 0) {
      issue(issues, "timeoutSeconds", "must be a positive number");
    }
  }
  if (payload.onTimeout !== undefined) {
    if (typeof payload.onTimeout !== "string" || !ON_TIMEOUT_VALUES.has(payload.onTimeout)) {
      issue(issues, "onTimeout", 'must be "cancel" or "default"');
    }
  }

  if (!Array.isArray(payload.questions) || payload.questions.length === 0) {
    issue(issues, "questions", "must be a non-empty array");
  } else {
    const ids = new Set<string>();
    payload.questions.forEach((questionRaw: unknown, questionIndex: number) => {
      const prefix = `questions[${questionIndex}]`;
      if (!isObject(questionRaw)) {
        issue(issues, prefix, "must be an object");
        return;
      }
      const question = questionRaw;
      checkString(question.id, `${prefix}.id`, issues);
      if (typeof question.id === "string") {
        if (ids.has(question.id)) issue(issues, `${prefix}.id`, "must be unique");
        ids.add(question.id);
      }
      checkString(question.prompt, `${prefix}.prompt`, issues);
      if (typeof question.type !== "string" || !QUESTION_TYPES.has(question.type)) {
        issue(issues, `${prefix}.type`, "must be single, multiple, or text");
      }
      if (question.required !== undefined && typeof question.required !== "boolean") {
        issue(issues, `${prefix}.required`, "must be a boolean");
      }
      if (question.allowOther !== undefined && typeof question.allowOther !== "boolean") {
        issue(issues, `${prefix}.allowOther`, "must be a boolean");
      }
      if (question.placeholder !== undefined) checkString(question.placeholder, `${prefix}.placeholder`, issues, { required: false });

      const choiceQuestion = question.type === "single" || question.type === "multiple";
      if (!choiceQuestion && question.allowOther !== undefined) {
        issue(issues, `${prefix}.allowOther`, "is only valid for choice questions");
      }
      if (choiceQuestion && question.allowOther === undefined) (question as unknown as Question).allowOther = true;

      if (choiceQuestion && (!Array.isArray(question.options) || question.options.length === 0)) {
        issue(issues, `${prefix}.options`, "is required and must be a non-empty array for choice questions");
      }
      if (!choiceQuestion && question.options !== undefined) {
        issue(issues, `${prefix}.options`, "is only valid for choice questions");
      }

      const optionValues = new Set<string>();
      if (Array.isArray(question.options)) {
        question.options.forEach((optionRaw: unknown, optionIndex: number) => {
          const optionPrefix = `${prefix}.options[${optionIndex}]`;
          if (!isObject(optionRaw)) {
            issue(issues, optionPrefix, "must be an object");
            return;
          }
          checkString(optionRaw.value, `${optionPrefix}.value`, issues);
          checkString(optionRaw.label, `${optionPrefix}.label`, issues);
          if (optionRaw.description !== undefined) {
            checkString(optionRaw.description, `${optionPrefix}.description`, issues, { required: false });
          }
          if (typeof optionRaw.value === "string") {
            if (optionValues.has(optionRaw.value)) issue(issues, `${optionPrefix}.value`, "must be unique within this question");
            optionValues.add(optionRaw.value);
          }
        });
      }

      if (question.default !== undefined) {
        if (question.type === "multiple") {
          if (!Array.isArray(question.default) || question.default.some((v: unknown) => typeof v !== "string")) {
            issue(issues, `${prefix}.default`, "must be an array of strings for a multiple-choice question");
          } else if (!question.default.every((v: string) => optionValues.has(v))) {
            issue(issues, `${prefix}.default`, "must reference known option values");
          }
        } else if (question.type === "single") {
          if (typeof question.default !== "string") {
            issue(issues, `${prefix}.default`, "must be a string for a single-choice question");
          } else if (!optionValues.has(question.default)) {
            issue(issues, `${prefix}.default`, "must reference a known option value");
          }
        } else {
          if (typeof question.default !== "string") issue(issues, `${prefix}.default`, "must be a string for a text question");
        }
      }
    });
  }

  if (payload.documents !== undefined) {
    if (!Array.isArray(payload.documents)) {
      issue(issues, "documents", "must be an array");
    } else {
      const ids = new Set<string>();
      payload.documents.forEach((documentRaw: unknown, index: number) => {
        const prefix = `documents[${index}]`;
        if (!isObject(documentRaw)) {
          issue(issues, prefix, "must be an object");
          return;
        }
        checkString(documentRaw.id, `${prefix}.id`, issues);
        if (typeof documentRaw.id === "string") {
          if (ids.has(documentRaw.id)) issue(issues, `${prefix}.id`, "must be unique");
          ids.add(documentRaw.id);
        }
        checkString(documentRaw.title, `${prefix}.title`, issues);
        const hasMarkdown = Object.hasOwn(documentRaw, "markdown");
        const hasPath = Object.hasOwn(documentRaw, "path");
        if (hasMarkdown === hasPath) issue(issues, prefix, "must contain exactly one of markdown or path");
        if (hasMarkdown) checkString(documentRaw.markdown, `${prefix}.markdown`, issues, { required: false });
        if (hasPath) checkString(documentRaw.path, `${prefix}.path`, issues);
      });
    }
  }

  if (issues.length) throw new ContractError("The input payload is invalid.", issues);
  return payload as unknown as AskPayload;
}
