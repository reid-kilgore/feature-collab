// Request/response types shared between the daemon (server.ts) and the CLI (client.ts).
// Transport: newline-delimited JSON over a unix socket.

import type { AskPayload, AskResult } from "../contract/payload.ts";
import type { Level } from "../contract/notify.ts";

export interface NotifyRequest {
  op: "notify";
  level: Level;
  title?: string;
  body?: string;
  imagePath?: string;
  filePath?: string;
  caption?: string;
  channel: string;
}

export interface AskRequest {
  op: "ask";
  payload: AskPayload;
  askerPath: string;
  askerTmuxWindow?: string;
  timeoutSeconds?: number;
  onTimeout?: "cancel" | "default";
}

export interface StatusRequest {
  op: "status";
}

export interface PendingRequest {
  op: "pending";
}

export interface CancelRequest {
  op: "cancel";
  id: string; // batch id, or "all"
}

export interface WaitRequest {
  op: "wait";
  id: string;
}

export interface RecvRequest {
  op: "recv";
  wait: boolean;
  peek: boolean;
  timeoutSeconds?: number;
  channel: string;
}

export type DaemonRequest =
  | NotifyRequest
  | AskRequest
  | StatusRequest
  | PendingRequest
  | CancelRequest
  | WaitRequest
  | RecvRequest;

export interface NotifyResponse {
  ok: true;
}

export interface AskAcceptedResponse {
  id: string;
}

export interface AskResolvedResponse {
  result: AskResult;
}

export interface StatusResponse {
  alive: true;
  botUsername: string;
  hostname: string;
  allowedUserId: string;
  allowedChatId: string;
  pendingCount: number;
  lastUpdateAgeSeconds: number | null;
  startedAt: string;
  unreadInbox: number;
  listening: boolean;
  channels: ChannelStatus[];
}

export interface ChannelStatus {
  channel: string;
  lastSendAgeSeconds: number | null;
  listening: boolean;
  unread: number;
}

export interface InboxMessage {
  id: string;
  at: string;
  text?: string;
  photoPath?: string;
  filePath?: string;
}

export interface RecvResponse {
  version: 1;
  status: "received" | "timeout";
  messages: InboxMessage[];
}

export interface PendingItem {
  batchId: string;
  questionId: string;
  title?: string;
  prompt: string;
  createdAt: string;
  askerPath: string;
}

export interface PendingResponse {
  items: PendingItem[];
}

export interface CancelResponse {
  cancelled: number;
}

export interface ErrorResponse {
  error: string;
}

export type DaemonResponse =
  | NotifyResponse
  | AskAcceptedResponse
  | AskResolvedResponse
  | StatusResponse
  | PendingResponse
  | CancelResponse
  | RecvResponse
  | ErrorResponse;
