import type { conversations } from '@/db/schema';
import type { Rumor } from '@/db/schema/types';

import { takeNotificationEvents, type NotificationKind } from './notification-events.service';

export type NotificationConversation = Pick<typeof conversations.$inferSelect,
  'conversationKey' | 'deliveryKind' | 'groupId'>;
export type NotificationCandidate = {
  rumor: Rumor;
  kind: Exclude<NotificationKind, 'reaction'>;
  conversation: NotificationConversation;
};

/** The incoming rumor batch only wakes delivery. Eligibility and ownership come
 * from committed events, so another runtime can deliver an extension-owned insert. */
export async function filterNotifiableMessages(
  _rumors: Rumor[],
  accountPubkey: string,
  deliveryKind?: NotificationConversation['deliveryKind'],
): Promise<NotificationCandidate[]> {
  const candidates: NotificationCandidate[] = [];
  let throughId: number | undefined;
  while (true) {
    const batch = await takeNotificationEvents(accountPubkey, 'system', throughId, deliveryKind);
    for (const row of batch.events) {
      const kind = row.event.kind === 'reaction'
        ? (row.conversation.hasReplied ? 'message' : 'request')
        : row.event.kind;
      const { conversationKey, deliveryKind, groupId } = row.conversation;
      candidates.push({ rumor: row.message.rumor, kind, conversation: { conversationKey, deliveryKind, groupId } });
    }
    if (!batch.more) return candidates;
    throughId = batch.throughId;
  }
}
