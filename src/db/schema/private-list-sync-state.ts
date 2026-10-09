import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { accounts } from './accounts';

/** Durable revisions protect unsynced block/mute plaintext across restarts. */
export const privateListSyncState = sqliteTable('private_list_sync_state', {
  accountPubkey: text('account_pubkey').notNull()
    .references(() => accounts.pubkey, { onDelete: 'cascade' }),
  dTag: text('d_tag').notNull(),
  revision: integer('revision').notNull().default(0),
  dirty: integer('dirty', { mode: 'boolean' }).notNull().default(false),
  eventId: text('event_id'),
}, (t) => [primaryKey({ columns: [t.accountPubkey, t.dTag] })]);
