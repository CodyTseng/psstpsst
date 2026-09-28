import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import type { Rumor } from './types';

export const groupMemberActions = sqliteTable(
  'group_member_actions',
  {
    accountPubkey: text('account_pubkey').notNull(),
    conversationKey: text('conversation_key').notNull(),
    eventId: text('event_id').notNull(),
    authorPubkey: text('author_pubkey').notNull(),
    memberPubkey: text('member_pubkey').notNull(),
    action: text('action', { enum: ['invite', 'remove'] }).notNull(),
    orderAt: integer('order_at').notNull(),
    rumor: text('rumor', { mode: 'json' }).$type<Rumor>().notNull(),
    /** Whether this action currently contributes to the materialized roster. */
    applied: integer('applied', { mode: 'boolean' }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.accountPubkey, t.eventId] }),
    index('idx_group_action_order').on(
      t.accountPubkey,
      t.conversationKey,
      t.orderAt,
      t.eventId,
    ),
  ],
);
