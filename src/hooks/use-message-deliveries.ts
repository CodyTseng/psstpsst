import { and, eq } from 'drizzle-orm';
import { useMemo } from 'react';

import { db } from '@/db/client';
import { messageDeliveryCopies, messages } from '@/db/schema';
import { useLiveQuery } from '@/db/use-live-query';
import type { MessageDelivery } from '@/stores/delivery-status.store';

/**
 * Load relay detail only while the message-info sheet is visible. Message rows
 * keep reading their coarse state directly from `messages.delivery_status`.
 */
export function useMessageDelivery(
  accountPubkey: string,
  messageId: string | null,
  liveDataEnabled = true,
): MessageDelivery | null {
  const safeId = messageId ?? ' ';
  const queryEnabled = liveDataEnabled && messageId != null;
  const { data: copies, isResolved: copiesResolved } = useLiveQuery(
    db
      .select()
      .from(messageDeliveryCopies)
      .where(
        and(
          eq(messageDeliveryCopies.accountPubkey, accountPubkey),
          eq(messageDeliveryCopies.messageId, safeId),
        ),
      ),
    [accountPubkey, safeId, 'delivery-copies', queryEnabled],
    { enabled: queryEnabled },
  );
  const { data: messageRows, isResolved: messageResolved } = useLiveQuery(
    db
      .select({
        deliveryStatus: messages.deliveryStatus,
        deliveryError: messages.deliveryError,
      })
      .from(messages)
      .where(and(eq(messages.accountPubkey, accountPubkey), eq(messages.id, safeId)))
      .limit(1),
    [accountPubkey, safeId, 'delivery-message', queryEnabled],
    { enabled: queryEnabled },
  );

  return useMemo(() => {
    if (!copiesResolved || !messageResolved) return null;
    const message = messageRows?.[0];
    if (!message?.deliveryStatus) return null;
    return {
      rumorId: safeId,
      phase: message.deliveryStatus,
      error: message.deliveryError ?? undefined,
      copies: (copies ?? []).map((copy) => ({
        recipient: copy.recipientPubkey,
        self: copy.recipientPubkey === accountPubkey,
        relays: copy.relays,
      })),
    };
  }, [accountPubkey, copies, copiesResolved, messageResolved, messageRows, safeId]);
}
