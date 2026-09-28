import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export type DeliveryRelayRecord = {
  url: string;
  status: 'pending' | 'ok' | 'failed';
  error?: string;
};

/**
 * Durable relay outcomes for one recipient's gift-wrapped copy. Relay fan-out
 * is capped at four, so keeping that bounded array together avoids repeating
 * message and recipient keys for every long-lived relay result. The queue uses
 * normalized target rows while work is active; this table is the compact
 * historical read model.
 */
export const messageDeliveryCopies = sqliteTable(
  'message_delivery_copies',
  {
    accountPubkey: text('account_pubkey').notNull(),
    messageId: text('message_id').notNull(),
    recipientPubkey: text('recipient_pubkey').notNull(),
    relays: text('relays', { mode: 'json' }).$type<DeliveryRelayRecord[]>().notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.accountPubkey, t.messageId, t.recipientPubkey] }),
    index('idx_delivery_copy_message').on(t.accountPubkey, t.messageId),
  ],
);
