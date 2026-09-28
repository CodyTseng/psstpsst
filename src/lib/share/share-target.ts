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
