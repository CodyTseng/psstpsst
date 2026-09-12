import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

/** Per-relay outcome for one copy of a message (settled only). */
export type DeliveryRelayRecord = {
  url: string;
  status: 'ok' | 'failed';
  /** Failure reason, kept so it can be inspected later (failed relays only). */
  error?: string;
};

/**
 * One gift-wrapped copy of a message and its per-relay outcome. A message is
 * wrapped once per recipient plus once to self (multi-device sync); each copy is
 * published to that target's own relays and settles independently. Recording
 * per copy (rather than one merged relay list) keeps two recipients that share a
 * relay distinct and lets a group send show who actually received it.
 */
export type DeliveryCopyRecord = {
  /** Pubkey this copy was addressed to (a recipient, or our own for `self`). */
  recipient: string;
  /** The self/sync copy (published to our own relays; recorded but not surfaced
   * as "delivered to the other party"). */
  self: boolean;
  relays: DeliveryRelayRecord[];
};

/**
 * Persisted delivery summary for an outgoing message, so the send status
 * survives an app restart (the in-memory `delivery-status.store` only powers the
 * live send animation within a session). One row per message, written once the
 * publish settles, holding **every copy** (recipients + self).
 *
 * `status` is the coarse verdict over the **recipient** (non-self) copies,
 * decided by majority: 'sent' when at least half of their relays accepted (and
 * at least one did), otherwise 'failed' — whether the other party received it.
 */
export const messageDeliveries = sqliteTable(
  'message_deliveries',
  {
    messageId: text('message_id').primaryKey(),
    conversationKey: text('conversation_key').notNull(),
    /** Every copy of this message (recipients + self), each with its relay
     * results. */
    copies: text('copies', { mode: 'json' })
      .$type<DeliveryCopyRecord[]>()
      .notNull(),
    status: text('status', { enum: ['sent', 'failed'] }).notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('idx_delivery_conversation').on(t.conversationKey)],
);
