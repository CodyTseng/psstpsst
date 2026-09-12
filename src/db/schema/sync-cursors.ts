import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const syncCursors = sqliteTable('sync_cursors', {
  accountPubkey: text('account_pubkey').primaryKey(),
  forwardSince: integer('forward_since'),
  backwardUntil: integer('backward_until'),
  updatedAt: integer('updated_at').notNull(),
});
