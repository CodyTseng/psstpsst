import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { accounts } from './accounts';
import type { NostrEvent } from './types';

/** Only unconfirmed configuration snapshots live here; one per Nostr coordinate. */
export const configurationOutbox = sqliteTable('configuration_outbox', {
  accountPubkey: text('account_pubkey').notNull().references(() => accounts.pubkey, { onDelete: 'cascade' }),
  kind: integer('kind').notNull(),
  dTag: text('d_tag').notNull().default(''),
  eventId: text('event_id').notNull(),
  event: text('event', { mode: 'json' }).$type<NostrEvent>().notNull(),
  acknowledgedRelays: text('acknowledged_relays', { mode: 'json' }).$type<string[]>().notNull().default([]),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: integer('next_attempt_at').notNull(),
  lastError: text('last_error'),
}, (t) => [
  primaryKey({ columns: [t.accountPubkey, t.kind, t.dTag] }),
  index('idx_configuration_outbox_due').on(t.accountPubkey, t.nextAttemptAt),
]);
