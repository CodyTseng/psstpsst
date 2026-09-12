import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

/**
 * An unsent composer draft for one conversation — **device-local**, never synced
 * (a draft is where *this* device left off typing, not a property of the chat).
 * Keyed by (account, conversationKey) so it survives restarts; the runtime read
 * model is the in-memory {@link ../../stores/drafts.store}, this table is just its
 * persistence. A conversation needs no row in `conversations` to have a draft, so
 * drafts for brand-new (never-sent) chats are preserved too.
 */
export const messageDrafts = sqliteTable(
  'message_drafts',
  {
    accountPubkey: text('account_pubkey').notNull(),
    conversationKey: text('conversation_key').notNull(),
    text: text('text').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.accountPubkey, t.conversationKey] })],
);
