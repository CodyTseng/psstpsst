import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import type { NostrEvent } from './types';

/** Verified immutable events shared by message references and immutable applications. */
export const cachedEvents = sqliteTable(
  'cached_events',
  {
    id: text('id').primaryKey(),
    event: text('event', { mode: 'json' }).$type<NostrEvent>().notNull(),
    relays: text('relays', { mode: 'json' }).$type<string[]>().notNull().default([]),
    fetchedAt: integer('fetched_at').notNull(),
  },
  (t) => [index('idx_cached_events_fetched_at').on(t.fetchedAt)],
);
