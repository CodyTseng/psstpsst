import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';

export const relayLists = sqliteTable(
  'relay_lists',
  {
    accountPubkey: text('account_pubkey').notNull(),
    relayUrl: text('relay_url').notNull(),
    read: integer('read', { mode: 'boolean' }).notNull().default(true),
    write: integer('write', { mode: 'boolean' }).notNull().default(true),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.accountPubkey, t.relayUrl] }),
    index('idx_relay_lists_account').on(t.accountPubkey),
  ],
);
