// The unconsumed-message alarm (DESIGN-dispatcher.md, "The stall alarm"). It needs no Claude session: when a
// message on the dispatcher channel has sat unread longer than the threshold, the daemon hands it to the default
// target itself, as `tg dispatch <target>` would, and tells Reid once. One alarm per message, written to the
// audit table before anything is done, so a daemon restart or a failed hand-off never causes a second one.

import { appendInquiry, findInquiry, readInquiries } from "../core/inquiry-log.ts";
import type { InboxRow, Store } from "../core/store.ts";
import { activeDispatcher } from "../dispatcher/config.ts";
import { handOffToTarget } from "../dispatcher/handoff.ts";
import { formatAge } from "../dispatcher/health.ts";
import { REACTION_HANDED_OFF } from "../transports/telegram/reactions.ts";
import type { TelegramApi } from "../transports/telegram/api.ts";

export interface StallDeps {
  store: Store;
  api: TelegramApi;
  chatId: string;
  log: (line: string) => void;
  thresholdMs: number;
}

let running = false;

function snippet(text: string | null): string {
  const one = (text ?? "(attachment)").replace(/\s+/g, " ").trim();
  return one.length > 60 ? `${one.slice(0, 57)}...` : one;
}

export async function checkStalledMessages(deps: StallDeps): Promise<void> {
  if (running) return;
  const config = activeDispatcher();
  if (!config) return;
  running = true;
  try {
    const cutoff = new Date(Date.now() - deps.thresholdMs).toISOString();
    for (const row of deps.store.listStalledInbox(config.channel, cutoff)) await alarm(deps, row, config.defaultTarget, config.targets);
  } finally {
    running = false;
  }
}

async function alarm(deps: StallDeps, row: InboxRow, defaultTarget: string | undefined, targets: Parameters<typeof handOffToTarget>[0][]): Promise<void> {
  const { store, api, chatId, log } = deps;
  const ageSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(row.at)) / 1000));
  const target = targets.find((t) => t.name === defaultTarget);
  // The alarm row comes first: from here on this message is never alarmed again.
  store.appendAudit("dispatcher_stall_alarm", null, null, { inbox: row.id, ageSeconds, target: defaultTarget ?? null });
  // Take the message out of the dispatcher's queue while it is being handed over, so a dispatcher that comes
  // back at this moment does not route it a second time. A failed hand-off puts it back.
  store.consumeInbox([row.id]);

  let error: string | undefined;
  let ref = "";
  if (!target) {
    error = defaultTarget ? `the default target "${defaultTarget}" is not in dispatcher.json` : "dispatcher.json names no default target";
  } else {
    const result = await handOffToTarget(target, {
      text: row.text,
      replyToQuote: row.reply_quote,
      replyToChannel: row.reply_channel,
      photoPath: row.photo_path,
      filePath: row.file_path,
    }).catch((e: Error) => ({ ok: false, ref: "", error: e.message }));
    if (result.ok) ref = result.ref;
    else error = result.error;
  }

  const age = formatAge(ageSeconds);
  let notice: string;
  if (error === undefined && target) {
    const inquiry = findInquiry(readInquiries(), row.inquiry_id ?? row.id);
    if (inquiry) appendInquiry({ op: "state", id: inquiry.id, at: new Date().toISOString(), state: "handed_off", target: target.name, ref, note: "daemon stall alarm" });
    if (row.tg_message_id) void api.setMessageReaction(chatId, row.tg_message_id, REACTION_HANDED_OFF);
    store.appendAudit("dispatcher_stall_handoff", null, null, { inbox: row.id, ok: true, target: target.name, ref });
    notice = `The dispatcher was not listening, so I passed your message on to ${target.name}${ref ? ` as ${ref}` : ""}. It had waited ${age}: "${snippet(row.text)}"`;
  } else {
    store.unconsumeInbox(row.id);
    store.appendAudit("dispatcher_stall_handoff", null, null, { inbox: row.id, ok: false, error });
    notice = `The dispatcher was not listening and I could not pass your message on (${(error ?? "unknown error").replace(/[`\n]+/g, " ").slice(0, 160)}). It has waited ${age} and is still queued: "${snippet(row.text)}"`;
  }
  log(`stall alarm for ${row.id} (${age}): ${error === undefined ? `handed to ${target?.name}` : `hand-off failed: ${error}`}`);
  await api
    .sendMessage(chatId, notice, row.tg_message_id ? { replyToMessageId: row.tg_message_id } : {})
    .catch((e: Error) => log(`stall alarm notice failed: ${e.message}`));
}
