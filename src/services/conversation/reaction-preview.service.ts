import { and, eq } from 'drizzle-orm';

import { db, type Database } from '@/db/client';
import { conversations, messages, notificationEvents, type Rumor } from '@/db/schema';
import { isMessageOrderNewer } from '@/lib/nostr/message-order';
import { parseReactionPreview } from '@/lib/nostr/reaction-preview';
import { platform } from '@/platform';
import { KIND_REACTION } from '@/services/crypto/nip17-gift-wrap';
import { isActiveConversationVisible, type ActiveConversation, type ConversationPresence } from '@/services/dm/active-conversation';
import { recordNotificationEvent } from '@/services/notifications/notification-events.service';

import { reactionTargetsOwnVisibleMessage } from './reaction-target';

type Conversation = typeof conversations.$inferSelect;
let viewing: ActiveConversation | null = null;

function conversationScope({ accountPubkey, conversationKey }: ActiveConversation) {
  return and(
    eq(conversations.accountPubkey, accountPubkey),
    eq(conversations.conversationKey, conversationKey),
  );
}

/** Start at route activation, including a rendered desktop detail pane. */
export function watchReactionPreviewWhileViewing(accountPubkey: string, conversationKey: string): () => void {
  const current = { accountPubkey, conversationKey };
  viewing = current;
  const isViewing = () => viewing === current && !platform.notifications.shouldNotifyNow();
  const clear = () => {
    if (!isViewing()) return;
    void db.transaction(async tx => {
      if (!isViewing()) return;
      const cleared = await tx.update(conversations).set({ reactionPreviewPending: false })
        .where(and(conversationScope(current), eq(conversations.reactionPreviewPending, true)))
        .returning({ conversationKey: conversations.conversationKey });
      if (cleared.length === 0) return;
      await tx.delete(notificationEvents).where(and(
        eq(notificationEvents.accountPubkey, accountPubkey),
        eq(notificationEvents.conversationKey, conversationKey),
        eq(notificationEvents.kind, 'reaction'),
      ));
    })
      .catch((error) => console.warn('[reaction-preview] Could not clear preview.', error));
  };
  const removeListener = platform.notifications.addUserReturnedListener(clear);
  // Extension intake may have captured presence before this route opened.
  const removeDatabaseListener = platform.database.addChangeListener(event => {
    if (event.external && (!event.tableName || event.tableName === 'conversations')) clear();
  });
  clear();
  return () => {
    if (viewing === current) viewing = null;
    removeListener();
    removeDatabaseListener();
  };
}

/** Record a new eligible reaction in its transaction and report whether it queued a system alert. */
export async function recordReactionPreview(
  tx: Database,
  scope: ActiveConversation,
  rumor: Rumor,
  orderAt: number,
  getPresence: () => ConversationPresence,
  options: { deliveryKind?: Conversation['deliveryKind']; notify?: boolean } = {},
): Promise<boolean> {
  if (rumor.kind !== KIND_REACTION || !parseReactionPreview(rumor.content, rumor.tags)) return false;
  const conversation = await tx.select().from(conversations).where(conversationScope(scope)).get();
  if (!conversation || conversation.deleted || conversation.deliveryKind !== (options.deliveryKind ?? 'relay')) return false;
  const { accountPubkey, conversationKey } = conversation;

  const { reactionPreviewEventId, reactionPreviewOrderAt } = conversation;
  if (reactionPreviewEventId && reactionPreviewOrderAt !== null && !isMessageOrderNewer(
    { id: rumor.id, orderAt },
    { id: reactionPreviewEventId, orderAt: reactionPreviewOrderAt },
  )) return false;
  if (!await reactionTargetsOwnVisibleMessage(tx, conversation, rumor)) return false;

  const { userPresent, activeConversation } = getPresence();
  const active = isActiveConversationVisible(
    viewing ?? activeConversation, accountPubkey, conversationKey, userPresent,
  );
  await tx.update(conversations).set({
    reactionPreviewEventId: rumor.id,
    reactionPreviewOrderAt: orderAt,
    reactionPreviewPending: !active,
  }).where(conversationScope(conversation)).run();
  if (active || options.notify === false) return false;
  const queued = await recordNotificationEvent(tx, {
    accountPubkey,
    conversationKey,
    rumor,
    before: conversation,
    after: conversation,
    eligible: true,
    incoming: true,
    userPresent,
    reactionToOwnMessage: true,
  });
  return queued && !userPresent;
}

/** Keep the ordering cursor when its target is removed or expires. */
export async function clearReactionPreviewForDeletedTarget(
  tx: Database, conversation: Conversation, targetId: string,
): Promise<void> {
  if (!conversation.reactionPreviewPending || !conversation.reactionPreviewEventId) return;
  const reaction = conversation.reactionPreviewEventId === targetId || await tx.select({ id: messages.id }).from(messages).where(and(
    eq(messages.accountPubkey, conversation.accountPubkey),
    eq(messages.conversationKey, conversation.conversationKey),
    eq(messages.id, conversation.reactionPreviewEventId),
    eq(messages.replyToId, targetId),
  )).get();
  if (reaction) {
    await tx.update(conversations).set({ reactionPreviewPending: false })
      .where(and(conversationScope(conversation), eq(conversations.reactionPreviewEventId, conversation.reactionPreviewEventId))).run();
  }
}
