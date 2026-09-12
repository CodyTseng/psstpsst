import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { accounts } from './accounts';

/** Durable local revision and reconciliation watermark for the private contact set. */
export const contactSyncState = sqliteTable('contact_sync_state', {
  accountPubkey: text('account_pubkey')
    .primaryKey()
    .references(() => accounts.pubkey, { onDelete: 'cascade' }),
  revision: integer('revision').notNull().default(0),
  dirty: integer('dirty', { mode: 'boolean' }).notNull().default(false),
  eventCreatedAt: integer('event_created_at'),
  eventId: text('event_id'),
});
