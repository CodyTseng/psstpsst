import type { Rumor } from '@/db/schema/types';

import { takeNotificationEvents, type NotificationKind } from './notification-events.service';

export type NotificationCandidate = { rumor: Rumor; kind: NotificationKind };

/** The incoming rumor batch only wakes delivery. Eligibility and ownership come
 * from committed events, so another runtime can deliver an extension-owned insert. */
export async function filterNotifiableMessages(
  _rumors: Rumor[],
  accountPubkey: string,
): Promise<NotificationCandidate[]> {
  const candidates: NotificationCandidate[] = [];
  let throughId: number | undefined;
  while (true) {
    const batch = await takeNotificationEvents(accountPubkey, 'system', throughId);
    for (const row of batch.events) candidates.push({ rumor: row.message.rumor, kind: row.event.kind });
    if (!batch.more) return candidates;
    throughId = batch.throughId;
  }
}
