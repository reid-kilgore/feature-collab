// Messages sent with `tg send --key K` are remembered under K. Resolving K removes them: delete first, and when
// Telegram refuses (it will not delete after 48 hours), edit the message to "Resolved." so the stale link is
// at least gone. The same delete-then-edit shape as cancelling a question with --delete (core/interaction.ts).
// An unknown key, or one already resolved, has nothing open and does nothing.

import type { Store } from "./store.ts";

export interface KeyedMessageOps {
  tryDelete(chatId: string, messageId: number): Promise<true | { error: string }>;
  edit(chatId: string, messageId: number, text: string): Promise<void>;
}

export const RESOLVED_TEXT = "Resolved.";

export async function resolveKeyedMessages(store: Store, ops: KeyedMessageOps, chatId: string, key: string): Promise<{ deleted: number; edited: number }> {
  let deleted = 0;
  let edited = 0;
  for (const messageId of store.listOpenKeyedMessages(key)) {
    const outcome = await ops.tryDelete(chatId, messageId);
    if (outcome === true) {
      store.appendAudit("keyed_message_deleted", null, null, { key, message_id: messageId });
      deleted++;
    } else {
      let editError: string | null = null;
      try {
        await ops.edit(chatId, messageId, RESOLVED_TEXT);
      } catch (error) {
        editError = (error as Error).message;
      }
      store.appendAudit("keyed_message_delete_fell_back", null, null, { key, message_id: messageId, error: outcome.error, edit_error: editError });
      if (editError === null) edited++;
    }
    store.markKeyedMessageResolved(key, messageId);
  }
  return { deleted, edited };
}
