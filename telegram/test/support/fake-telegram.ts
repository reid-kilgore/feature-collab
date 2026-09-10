// A minimal fake Telegram Bot API server for integration tests, plus a control channel
// for injecting inbound updates (simulating a button tap or a text reply) and inspecting
// what the daemon sent.

import http from "node:http";
import type { AddressInfo } from "node:net";

export interface SentMessage {
  method:
    | "sendMessage"
    | "sendPhoto"
    | "sendDocument"
    | "editMessageText"
    | "editMessageReplyMarkup"
    | "deleteMessage"
    | "answerCallbackQuery"
    | "setMessageReaction"
    | "getFile";
  body: Record<string, unknown>;
}

export class FakeTelegram {
  server: http.Server;
  baseUrl = "";
  sent: SentMessage[] = [];
  private updates: Array<{ update_id: number } & Record<string, unknown>> = [];
  private nextUpdateId = 1;
  private nextMessageId = 1;

  constructor() {
    this.server = http.createServer((req, res) => this.onRequest(req, res));
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    const addr = this.server.address() as AddressInfo;
    this.baseUrl = `http://127.0.0.1:${addr.port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  // Simulate Reid tapping a button or sending a message.
  pushUpdate(update: Record<string, unknown>): number {
    const id = this.nextUpdateId++;
    this.updates.push({ update_id: id, ...update });
    return id;
  }

  pushCallback(opts: { chatId: number; userId: number; data: string; messageId?: number }): number {
    return this.pushUpdate({
      callback_query: {
        id: String(this.nextUpdateId),
        from: { id: opts.userId },
        message: { message_id: opts.messageId ?? 1, chat: { id: opts.chatId } },
        data: opts.data,
      },
    });
  }

  pushMessage(opts: { chatId: number; userId: number; text: string; replyToMessageId?: number }): number {
    return this.pushUpdate({
      message: {
        message_id: this.nextMessageId++,
        from: { id: opts.userId },
        chat: { id: opts.chatId },
        text: opts.text,
        ...(opts.replyToMessageId ? { reply_to_message: { message_id: opts.replyToMessageId } } : {}),
      },
    });
  }

  lastMessageTo(chatId: string | number, predicate?: (m: SentMessage) => boolean): SentMessage | undefined {
    const matches = this.sent.filter((m) => String(m.body.chat_id) === String(chatId) && (!predicate || predicate(m)));
    return matches[matches.length - 1];
  }

  private async onRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    const url = new URL(req.url ?? "/", "http://localhost");
    const contentType = req.headers["content-type"] ?? "";

    let body: Record<string, unknown> = {};
    if (contentType.includes("application/json") && raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = {};
      }
    } else if (contentType.includes("multipart/form-data")) {
      // We don't need the file bytes for assertions; extract the simple text fields.
      body = { chat_id: extractField(raw, "chat_id"), caption: extractField(raw, "caption") };
    }

    const json = (obj: unknown, status = 200) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };

    if (url.pathname === "/__control__/push") {
      const id = this.pushUpdate(body);
      return json({ ok: true, update_id: id });
    }
    if (url.pathname === "/__control__/sent") {
      return json({ ok: true, sent: this.sent });
    }

    const method = url.pathname.split("/").pop();
    switch (method) {
      case "getMe":
        return json({ ok: true, result: { id: 1, username: "fakebot", is_bot: true } });
      case "getUpdates": {
        const offset = Number(body.offset ?? 0);
        const pending = this.updates.filter((u) => u.update_id >= offset);
        return json({ ok: true, result: pending });
      }
      case "sendMessage":
      case "sendPhoto":
      case "sendDocument": {
        const id = this.nextMessageId++;
        this.sent.push({ method, body });
        return json({ ok: true, result: { message_id: id } });
      }
      case "editMessageText":
      case "editMessageReplyMarkup":
        this.sent.push({ method, body });
        return json({ ok: true, result: true });
      case "deleteMessage":
        this.sent.push({ method, body });
        return json({ ok: true, result: true });
      case "answerCallbackQuery":
        this.sent.push({ method, body });
        return json({ ok: true, result: true });
      case "setMessageReaction":
        this.sent.push({ method, body });
        return json({ ok: true, result: true });
      case "getFile":
        this.sent.push({ method, body });
        return json({ ok: true, result: { file_id: body.file_id, file_path: `fake/${body.file_id}` } });
      default:
        return json({ ok: false, description: `unknown method ${method}` }, 404);
    }
  }
}

function extractField(multipart: string, name: string): string | undefined {
  const re = new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r\\n]*)`);
  const m = re.exec(multipart);
  return m?.[1];
}
