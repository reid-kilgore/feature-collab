// Thin Telegram Bot API client over fetch. No retry/backoff logic here (the poller owns
// that for getUpdates); callers get back the raw decoded JSON or throw ApiError.

import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { redact } from "../../config.ts";

export class TelegramApiError extends Error {
  code?: number;
  constructor(message: string, code?: number) {
    super(message);
    this.name = "TelegramApiError";
    this.code = code;
  }
}

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface ReplyMarkup {
  inline_keyboard?: InlineKeyboardButton[][];
  force_reply?: true;
  selective?: true;
  remove_keyboard?: true;
}

export interface SendMessageResult {
  message_id: number;
}

export class TelegramApi {
  private token: string;
  private baseUrl: string;

  constructor(token: string, baseUrl: string = "https://api.telegram.org") {
    this.token = token;
    this.baseUrl = baseUrl;
  }

  private url(method: string): string {
    return `${this.baseUrl}/bot${this.token}/${method}`;
  }

  private async call<T>(method: string, body?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    let response: Response;
    try {
      response = await fetch(this.url(method), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
        signal,
      });
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") throw error;
      throw new TelegramApiError(redact(`network error calling ${method}: ${(error as Error).message}`));
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new TelegramApiError(redact(`invalid JSON from ${method} (status ${response.status})`));
    }
    const payload = json as { ok: boolean; result?: T; description?: string; error_code?: number };
    if (!payload.ok) {
      throw new TelegramApiError(redact(payload.description ?? `${method} failed`), payload.error_code);
    }
    return payload.result as T;
  }

  private async callMultipart<T>(method: string, fields: Record<string, string>, file: { field: string; path: string; filename: string }): Promise<T> {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    const data = await readFile(file.path);
    form.append(file.field, new Blob([new Uint8Array(data)]), file.filename);
    let response: Response;
    try {
      response = await fetch(this.url(method), { method: "POST", body: form });
    } catch (error) {
      throw new TelegramApiError(redact(`network error calling ${method}: ${(error as Error).message}`));
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new TelegramApiError(redact(`invalid JSON from ${method} (status ${response.status})`));
    }
    const payload = json as { ok: boolean; result?: T; description?: string; error_code?: number };
    if (!payload.ok) {
      throw new TelegramApiError(redact(payload.description ?? `${method} failed`), payload.error_code);
    }
    return payload.result as T;
  }

  async getMe(): Promise<{ id: number; username?: string; is_bot: boolean }> {
    return this.call("getMe");
  }

  async getUpdates(offset: number, timeoutSeconds = 0, signal?: AbortSignal): Promise<unknown[]> {
    return this.call<unknown[]>("getUpdates", { offset, timeout: timeoutSeconds, allowed_updates: ["message", "callback_query"] }, signal);
  }

  async sendMessage(chatId: string, text: string, opts: { html?: boolean; replyMarkup?: ReplyMarkup } = {}): Promise<SendMessageResult> {
    return this.call<SendMessageResult>("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: opts.html ? "HTML" : undefined,
      reply_markup: opts.replyMarkup,
    });
  }

  async editMessageText(chatId: string, messageId: number, text: string, opts: { html?: boolean; replyMarkup?: ReplyMarkup } = {}): Promise<void> {
    await this.call("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: opts.html ? "HTML" : undefined,
      reply_markup: opts.replyMarkup,
    });
  }

  async editMessageReplyMarkup(chatId: string, messageId: number, replyMarkup?: ReplyMarkup): Promise<void> {
    await this.call("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: replyMarkup });
  }

  async deleteMessage(chatId: string, messageId: number): Promise<void> {
    try {
      await this.call("deleteMessage", { chat_id: chatId, message_id: messageId });
    } catch {
      // best-effort
    }
  }

  async answerCallbackQuery(id: string, text?: string, showAlert = false): Promise<void> {
    await this.call("answerCallbackQuery", { callback_query_id: id, text, show_alert: showAlert });
  }

  async sendPhoto(chatId: string, filePath: string, caption?: string): Promise<SendMessageResult> {
    return this.callMultipart<SendMessageResult>(
      "sendPhoto",
      { chat_id: chatId, ...(caption ? { caption, parse_mode: "HTML" } : {}) },
      { field: "photo", path: filePath, filename: path.basename(filePath) },
    );
  }

  async sendDocument(chatId: string, filePath: string, caption?: string): Promise<SendMessageResult> {
    return this.callMultipart<SendMessageResult>(
      "sendDocument",
      { chat_id: chatId, ...(caption ? { caption, parse_mode: "HTML" } : {}) },
      { field: "document", path: filePath, filename: path.basename(filePath) },
    );
  }

  async getFile(fileId: string): Promise<{ file_path?: string }> {
    return this.call("getFile", { file_id: fileId });
  }

  // Downloads a file previously resolved via getFile and writes it to destPath.
  async downloadFile(telegramFilePath: string, destPath: string): Promise<void> {
    const url = `${this.baseUrl}/file/bot${this.token}/${telegramFilePath}`;
    const response = await fetch(url);
    if (!response.ok) throw new TelegramApiError(`could not download file (status ${response.status})`);
    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(destPath, buffer);
  }

  async setMessageReaction(chatId: string, messageId: number, emoji: string): Promise<void> {
    try {
      await this.call("setMessageReaction", { chat_id: chatId, message_id: messageId, reaction: [{ type: "emoji", emoji }] });
    } catch {
      // best-effort: never let reaction feedback break message handling
    }
  }
}

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

export async function classifyAttachment(filePath: string): Promise<{ kind: "photo" | "document"; size: number }> {
  const stats = await stat(filePath);
  const ext = path.extname(filePath).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext) && stats.size <= MAX_PHOTO_BYTES) return { kind: "photo", size: stats.size };
  if (stats.size > MAX_DOCUMENT_BYTES) {
    throw new TelegramApiError(`file ${filePath} is larger than the 50 MB Telegram document limit`);
  }
  return { kind: "document", size: stats.size };
}
