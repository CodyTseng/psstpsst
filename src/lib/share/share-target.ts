import type { ConversationDeliveryKind } from '@/lib/conversation/capabilities';

/** One existing conversation or newly addressed 1:1 recipient in the share flow. */
export type ShareTarget = {
  conversationKey: string;
  deliveryKind: ConversationDeliveryKind;
  name: string | null;
  group?: boolean;
  groupMemberPubkeys?: string[];
};

export function shareTargetId(target: Pick<ShareTarget, 'conversationKey' | 'deliveryKind'>): string {
  return `${target.deliveryKind}:${target.conversationKey}`;
}

/** Route identifiers only; the share payload stays outside navigation state. */
export function shareTargetHref(target: ShareTarget): `/chat/${string}` {
  const path: `/chat/${string}` = `/chat/${encodeURIComponent(target.conversationKey)}`;
  return target.deliveryKind === 'proximity'
    ? `${path}?transport=proximity&name=${encodeURIComponent(target.name ?? '')}`
    : path;
}
