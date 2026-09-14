import type { ConversationWithLast } from '@/hooks/use-conversations';

export type ConversationMessageBaseline = ReadonlyMap<
  string,
  { lastMessageId: string | null; unreadCount: number }
>;

export function conversationMessageBaseline(
  items: ConversationWithLast[],
): Map<string, { lastMessageId: string | null; unreadCount: number }> {
  return new Map(
    items.map((item) => [
      item.conversation.conversationKey,
      {
        lastMessageId: item.conversation.lastMessageId,
        unreadCount: item.conversation.unreadCount,
      },
    ]),
  );
}

/** Finds the newest newly-arrived incoming message outside the open chat. */
export function findIncomingConversation(
  previous: ConversationMessageBaseline,
  items: ConversationWithLast[],
  accountPubkey: string,
  activeConversationKey: string,
): ConversationWithLast | null {
  let newest: ConversationWithLast | null = null;

  for (const item of items) {
    const conversation = item.conversation;
    const prior = previous.get(conversation.conversationKey);
    const messageChanged =
      !!conversation.lastMessageId && conversation.lastMessageId !== prior?.lastMessageId;
    const unreadIncreased = conversation.unreadCount > (prior?.unreadCount ?? 0);
    const incoming =
      item.lastMessageSenderPubkey != null &&
      (conversation.deliveryKind === 'proximity'
        ? item.lastMessageSenderPubkey === conversation.conversationKey
        : item.lastMessageSenderPubkey !== accountPubkey);

    if (
      conversation.conversationKey === activeConversationKey ||
      conversation.muted ||
      !messageChanged ||
      !unreadIncreased ||
      !incoming
    ) {
      continue;
    }

    if (
      !newest ||
      conversation.lastMessageOrderAt > newest.conversation.lastMessageOrderAt
    ) {
      newest = item;
    }
  }

  return newest;
}
