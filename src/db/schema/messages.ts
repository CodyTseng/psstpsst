import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core';

import type { Rumor } from './types';

export const messages = sqliteTable(
  'messages',
  {
    /** The account that owns this copy of the message. Every account keeps its
     * own row even for the same rumor: when two accounts on this device DM each
     * other they each receive (and store) their own gift wrap, so the shared
     * `id` is no longer a global identity — `(account_pubkey, id)` is. This is
     * what isolates one account's history (and a future per-account wipe) from
     * another's. */
    accountPubkey: text('account_pubkey').notNull(),
    id: text('id').notNull(),
    conversationKey: text('conversation_key').notNull(),
    senderPubkey: text('sender_pubkey').notNull(),
    kind: integer('kind').notNull(),
    content: text('content').notNull(),
    createdAt: integer('created_at').notNull(),
    /** Normalized authenticated `ms` tag, or the legacy second floor. */
    orderAt: integer('order_at').notNull(),
    replyToId: text('reply_to_id'),
    subject: text('subject'),
    tags: text('tags', { mode: 'json' }).$type<string[][]>().notNull(),
    rumor: text('rumor', { mode: 'json' }).$type<Rumor>().notNull(),
    /**
     * Relays the incoming gift wrap was seen on (best-effort, captured at
     * receive time and persisted so the message-info drawer can show it after a
     * restart). Null for our own outgoing messages and for messages received
     * before this was tracked.
     */
    sourceRelays: text('source_relays', { mode: 'json' }).$type<string[]>(),
  },
  (t) => [
    primaryKey({ columns: [t.accountPubkey, t.id] }),
    index('idx_msg_conv_time').on(t.accountPubkey, t.conversationKey, t.orderAt, t.id),
  ],
);
