type ProximityConversationMessageUpdateInput = {
  newest: boolean;
  createdAt: number;
  orderAt: number;
  messageId: string;
};

/** Keeps an accepted proximity conversation in the inbox after storing a message. */
export function proximityConversationMessageUpdate({
  newest,
  createdAt,
  orderAt,
  messageId,
}: ProximityConversationMessageUpdateInput) {
  return {
    hasReplied: true as const,
    ...(newest
      ? {
          lastMessageAt: createdAt,
          lastMessageOrderAt: orderAt,
          lastMessageId: messageId,
          deleted: false as const,
        }
      : {}),
  };
}
