import type { ConversationWithLast } from '@/hooks/use-conversations';
import { isMessageOrderNewer } from '@/lib/nostr/message-order';
import type { ClaimedNotificationEvent } from '@/services/notifications/notification-events.service';

/** Presentation uses the event's source message, independently of list refreshes. */
export function selectIncomingNotification(
  events: ClaimedNotificationEvent[],
  activeConversationKey: string | null,
  options: { chatsVisible: boolean; quietRequests: boolean },
): ConversationWithLast | null {
  let latest: ClaimedNotificationEvent | null = null;
  for (const row of events) {
    if (row.conversation.conversationKey === activeConversationKey ||
      (row.event.kind === 'request' ? options.quietRequests : options.chatsVisible)) continue;
    if (!latest || isMessageOrderNewer(
      { id: row.message.id, orderAt: row.message.orderAt },
      { id: latest.message.id, orderAt: latest.message.orderAt },
    )) latest = row;
  }
  if (!latest) return null;
  const { conversation, message } = latest;
  return {
    conversation: { ...conversation, lastMessageId: message.id, lastMessageAt: message.createdAt, lastMessageOrderAt: message.orderAt },
    lastMessageContent: message.content, lastMessageKind: message.kind,
    lastMessageTags: message.tags, lastMessageSenderPubkey: message.senderPubkey,
  };
}
