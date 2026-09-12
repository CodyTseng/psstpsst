import { inArray } from 'drizzle-orm';
import { useLiveQuery } from '@/db/use-live-query';
import { useMemo } from 'react';

import { db } from '@/db/client';
import { messageDeliveries, outbox } from '@/db/schema';
import type { MessageDelivery } from '@/stores/delivery-status.store';

/**
 * Persisted delivery status for a specific set of messages (the loaded window),
 * keyed by message id. Survives app restarts (the in-memory
 * `delivery-status.store` only covers the live send within a session). A bubble
 * prefers its live entry and falls back to this. Scoped by message id so it
 * scales with what's on screen, not the whole history.
 */
export function useMessageDeliveries(
  messageIds: string[],
  liveDataEnabled = true,
): Record<string, MessageDelivery> {
  // inArray([]) is unsafe; use a never-matching sentinel when empty.
  const safeIds = messageIds.length > 0 ? messageIds : [' '];
  const queryEnabled = liveDataEnabled && messageIds.length > 0;
  const { data } = useLiveQuery(
    db
      .select()
      .from(messageDeliveries)
      .where(inArray(messageDeliveries.messageId, safeIds)),
    [safeIds.join(','), queryEnabled],
    { enabled: queryEnabled },
  );
  const { data: pending } = useLiveQuery(
    db.select().from(outbox).where(inArray(outbox.messageId, safeIds)),
    [safeIds.join(','), 'outbox', queryEnabled],
    { enabled: queryEnabled },
  );

  return useMemo(() => {
    const map: Record<string, MessageDelivery> = {};
    for (const row of data ?? []) {
      map[row.messageId] = {
        rumorId: row.messageId,
        phase: row.status, // 'sent' | 'failed'
        copies: (row.copies ?? []).map((cp) => ({
          recipient: cp.recipient,
          self: cp.self,
          relays: cp.relays.map((r) => ({
            url: r.url,
            status: r.status,
            error: r.error,
          })),
        })),
      };
    }
    for (const row of pending ?? []) {
      if (row.deliveryKind !== 'proximity') continue;
      map[row.messageId] = {
        rumorId: row.messageId,
        phase: row.status,
        transport: 'proximity',
        copies: [],
      };
    }
    return map;
  }, [data, pending]);
}
