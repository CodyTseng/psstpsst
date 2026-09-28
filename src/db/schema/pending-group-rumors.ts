import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import type { Rumor } from './types';

export type PendingGroupRumorReason =
  | 'pre_bootstrap'
  | 'pre_bootstrap_archive'
  | 'membership_candidate'
  | 'membership_candidate_archive';

export const pendingGroupRumors = sqliteTable(
  'pending_group_rumors',
  {
    accountPubkey: text('account_pubkey').notNull(),
    conversationKey: text('conversation_key').notNull(),
    messageId: text('message_id').notNull(),
    orderAt: integer('order_at').notNull(),
    senderPubkey: text('sender_pubkey').notNull(),
    rumor: text('rumor', { mode: 'json' }).$type<Rumor>().notNull(),
    sourceRelays: text('source_relays', { mode: 'json' }).$type<string[]>(),
    pendingReason: text('pending_reason').$type<PendingGroupRumorReason>().notNull(),
    receivedAt: integer('received_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.accountPubkey, t.messageId] }),
    index('idx_pending_group_order').on(
      t.accountPubkey,
      t.conversationKey,
      t.orderAt,
      t.messageId,
    ),
  ],
);
