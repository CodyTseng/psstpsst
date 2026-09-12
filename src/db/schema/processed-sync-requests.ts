import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const processedSyncRequests = sqliteTable(
  'processed_sync_requests',
  {
    eventId: text('event_id').primaryKey(),
    accountPubkey: text('account_pubkey').notNull(),
    processedAt: integer('processed_at').notNull(),
  },
  (t) => [index('idx_psr_account').on(t.accountPubkey)],
);
