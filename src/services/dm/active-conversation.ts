export type ActiveConversation = {
  accountPubkey: string;
  conversationKey: string;
};

/** A routed chat is being viewed only while the user is actually present. */
export function isActiveConversationVisible(
  active: ActiveConversation | null,
  accountPubkey: string,
  conversationKey: string,
  userPresent: boolean,
): boolean {
  return (
    userPresent &&
    active?.accountPubkey === accountPubkey &&
    active.conversationKey === conversationKey
  );
}
