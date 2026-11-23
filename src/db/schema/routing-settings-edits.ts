import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { accounts } from './accounts';

/** Local routing changes waiting for a signed declaration. */
export const routingSettingsEdits = sqliteTable('routing_settings_edits', {
  accountPubkey: text('account_pubkey').notNull().references(() => accounts.pubkey, { onDelete: 'cascade' }),
  kind: integer('kind').notNull(),
  urls: text('urls', { mode: 'json' }).$type<string[]>().notNull(),
  revision: integer('revision').notNull(),
  editedAt: integer('edited_at').notNull().default(0),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: integer('next_attempt_at').notNull(),
}, (t) => [
  primaryKey({ columns: [t.accountPubkey, t.kind] }),
  index('idx_routing_settings_edits_due').on(t.accountPubkey, t.nextAttemptAt),
]);
