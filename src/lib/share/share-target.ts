import type { ConversationDeliveryKind } from '@/lib/conversation/capabilities';

/** One existing or newly addressed 1:1 conversation in the share flow. */
export type ShareTarget = {
  conversationKey: string;
  deliveryKind: ConversationDeliveryKind;
  name: string | null;
};

export function shareTargetId(target: Pick<ShareTarget, 'conversationKey' | 'deliveryKind'>): string {
  return `${target.deliveryKind}:${target.conversationKey}`;
}
