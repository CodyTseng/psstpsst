import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';

/**
 * The account's preferred Blossom media-upload servers (BUD-03 "User Server
 * List", kind 10063). Mirrors `relay_lists`: per-account, ordered by rowid
 * insertion, fully replaced on edit. `updatedAt` carries the source event's
 * `created_at` so cross-device reconcile can do newest-wins.
 */
export const mediaServerLists = sqliteTable(
  'media_server_lists',
  {
    accountPubkey: text('account_pubkey').notNull(),
    serverUrl: text('server_url').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.accountPubkey, t.serverUrl] }),
    index('idx_media_server_lists_account').on(t.accountPubkey),
  ],
);
