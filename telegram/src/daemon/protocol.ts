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
  // Send as a Telegram reply to this message, and remember which inquiry it belongs to so that
  // Reid's answer to it carries the inquiry along (DESIGN-dispatcher.md, section 4).
  replyToMessageId?: number;
  inquiryId?: string;
  // Short name of the sending session, shown as a small italic last line.
  sender?: string;
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

export interface InquiryRequest {
  op: "inquiry";
  action: "state" | "asked" | "revive";
  id: string;
  state?: "handed_off" | "dropped";
  target?: string;
  ref?: string;
  tgMessageId?: number;
}

export interface InquiryResponse {
  ok: true;
  revived?: boolean;
}

export interface TrialRequest {
  op: "trial";
  text: string;
}

export interface TrialResponse {
  ok: true;
  id: string;
}

export interface QuarantineRequest {
  op: "quarantine";
  dryRun: boolean;
  // Also (instead of the unrouted rows) take unread rows on channels nobody is listening on that are
  // older than `olderSeconds`.
  staleChannels?: boolean;
  olderSeconds?: number;
}

export interface QuarantineResponse {
  quarantined: number;
  dryRun: boolean;
  byChannel?: Array<{ channel: string; count: number; oldest: string }>;
}

export type DaemonRequest =
  | NotifyRequest
  | AskRequest
  | StatusRequest
  | PendingRequest
  | CancelRequest
  | WaitRequest
  | RecvRequest
  | QuarantineRequest
  | InquiryRequest
  | TrialRequest;

export interface NotifyResponse {
  ok: true;
  // The first Telegram message the notification produced.
  messageId?: number;
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
  dispatcher: DispatcherStatus;
}

export interface DispatcherStatus {
  // "off" = no dispatcher.json, "invalid" = unreadable (see error), "disabled" = enabled:false.
  mode: "off" | "invalid" | "disabled" | "on";
  error?: string;
  channel?: string;
  listening?: boolean;
  queued?: number;
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
  tgMessageId?: number;
  replyTo?: { messageId: number; quote?: string; channel?: string };
  inquiry?: string;
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
  | QuarantineResponse
  | InquiryResponse
  | TrialResponse
  | ErrorResponse;
