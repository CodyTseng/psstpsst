import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';

export const conversations = sqliteTable(
  'conversations',
  {
    accountPubkey: text('account_pubkey').notNull(),
    conversationKey: text('conversation_key').notNull(),
    deliveryKind: text('delivery_kind', { enum: ['relay', 'proximity'] })
      .notNull()
      .default('relay'),
    /** Device-local identity that owns a Nearby conversation. Null for relay
     * conversations. Changing it requires an explicit identity migration. */
    proximityAccountPubkey: text('proximity_account_pubkey'),
    name: text('name'),
    createdAt: integer('created_at').notNull(),
    createdOrderAt: integer('created_order_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    updatedOrderAt: integer('updated_order_at').notNull(),
    lastMessageAt: integer('last_message_at'),
    lastMessageOrderAt: integer('last_message_order_at'),
    lastMessageId: text('last_message_id'),
    unreadCount: integer('unread_count').notNull().default(0),
    hasReplied: integer('has_replied', { mode: 'boolean' }).notNull().default(false),
    deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false),
    deletedAt: integer('deleted_at'),
    deletedOrderAt: integer('deleted_order_at'),
    muted: integer('muted', { mode: 'boolean' }).notNull().default(false),
    /** "Pinned" — pins the conversation to the top of the inbox (and floats the
     * row off the page with a surface fill). Distinct from `muted` (which
     * de-emphasises). */
    pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
    lastReadAt: integer('last_read_at'),
    lastReadOrderAt: integer('last_read_order_at'),
    /** Id of the newest message read here. Together with `lastReadOrderAt` it
     * forms the same `(order_at, id)` cursor used by the message list. */
    lastReadMessageId: text('last_read_message_id'),
    /** Raw h-tag value. Null keeps direct and Nearby conversations unchanged. */
    groupId: text('group_id'),
    /** Sorted active roster for a group. Null for non-group conversations. */
    memberPubkeys: text('member_pubkeys', { mode: 'json' }).$type<string[]>(),
    membersBootstrapOrderAt: integer('members_bootstrap_order_at'),
    membersBootstrapEventId: text('members_bootstrap_event_id'),
    membersActionOrderAt: integer('members_action_order_at'),
    membersActionEventId: text('members_action_event_id'),
    nameOrderAt: integer('name_order_at'),
    nameEventId: text('name_event_id'),
  },
  (t) => [
    primaryKey({ columns: [t.accountPubkey, t.conversationKey] }),
    index('idx_conv_last_msg').on(t.accountPubkey, t.lastMessageOrderAt),
    index('idx_conv_activity').on(t.accountPubkey, t.updatedOrderAt, t.conversationKey),
    index('idx_conv_backup_owner').on(
      t.accountPubkey,
      t.deliveryKind,
      t.proximityAccountPubkey,
      t.conversationKey,
    ),
  ],
);
