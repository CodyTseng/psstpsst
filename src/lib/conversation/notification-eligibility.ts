/** Shared conversation eligibility for system notifications and in-app banners. */
export function isNotifiableConversation(conversation: {
  hasReplied: boolean;
  muted: boolean;
}): boolean {
  return conversation.hasReplied && !conversation.muted;
}
