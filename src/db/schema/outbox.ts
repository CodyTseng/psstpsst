import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

import type { PendingPublishPayload } from './types';

export const outbox = sqliteTable(
  'outbox',
  {
    messageId: text('message_id').primaryKey(),
    accountPubkey: text('account_pubkey').notNull(),
    conversationKey: text('conversation_key').notNull().default(''),
    deliveryKind: text('delivery_kind', { enum: ['relay', 'proximity'] })
      .notNull()
      .default('relay'),
    status: text('status', {
      enum: ['queued', 'sending', 'awaiting_ack', 'sent', 'failed'],
    }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: integer('next_attempt_at'),
    lastError: text('last_error'),
    pendingPayload: text('pending_payload', { mode: 'json' }).$type<PendingPublishPayload>(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_outbox_account_status').on(t.accountPubkey, t.status),
    index('idx_outbox_drain').on(
      t.accountPubkey,
      t.deliveryKind,
      t.conversationKey,
      t.status,
      t.nextAttemptAt,
      t.updatedAt,
    ),
  ],
);
