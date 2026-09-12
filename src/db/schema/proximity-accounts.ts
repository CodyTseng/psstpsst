import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** One device-local proximity identity for each signed-in account. */
export const proximityAccounts = sqliteTable('proximity_accounts', {
  accountPubkey: text('account_pubkey').primaryKey(),
  proximityPubkey: text('proximity_pubkey').notNull().unique(),
  displayName: text('display_name').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
