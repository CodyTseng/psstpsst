import { eq } from 'drizzle-orm';
import { useMemo } from 'react';

import { db } from '@/db/client';
import { messageDeliveries, outbox } from '@/db/schema';
import { useLiveQuery } from '@/db/use-live-query';
import type { MessageDelivery } from '@/stores/delivery-status.store';

/**
 * Full persisted delivery detail for one opened message. Chat rows read their
 * coarse status directly from `messages`; the heavier per-copy/per-relay data
 * stays dormant until the detail sheet is visible.
 */
export function useMessageDelivery(
  messageId: string | null,
  liveDataEnabled = true,
): MessageDelivery | null {
  const safeId = messageId ?? ' ';
  const queryEnabled = liveDataEnabled && messageId != null;
  const { data, isResolved: deliveriesResolved } = useLiveQuery(
    db
      .select()
      .from(messageDeliveries)
      .where(eq(messageDeliveries.messageId, safeId))
      .limit(1),
    [safeId, queryEnabled],
    { enabled: queryEnabled },
  );
  const { data: pending, isResolved: outboxResolved } = useLiveQuery(
    db.select().from(outbox).where(eq(outbox.messageId, safeId)).limit(1),
    [safeId, 'outbox', queryEnabled],
    { enabled: queryEnabled },
  );

  return useMemo(() => {
    if (!deliveriesResolved || !outboxResolved) return null;
    const row = data?.[0];
    const pendingRow = pending?.[0];
    let delivery: MessageDelivery | null = row
      ? {
          rumorId: row.messageId,
          phase: row.status,
          copies: (row.copies ?? []).map((copy) => ({
            recipient: copy.recipient,
            self: copy.self,
            relays: copy.relays.map((relay) => ({
              url: relay.url,
              status: relay.status,
              error: relay.error,
            })),
          })),
        }
      : null;
    if (pendingRow) {
      delivery = {
        ...(delivery ?? { rumorId: pendingRow.messageId, copies: [] }),
        phase: pendingRow.status,
        transport: pendingRow.deliveryKind,
        error: pendingRow.lastError ?? delivery?.error,
      };
    }
    return delivery;
  }, [data, deliveriesResolved, outboxResolved, pending]);
}
