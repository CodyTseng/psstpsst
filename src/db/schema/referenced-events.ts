import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import type { NostrEvent } from './types';

/** Public events resolved for note/nevent message references. Event ids are
 * immutable, so successful relay results can be reused across app sessions. */
export const referencedEvents = sqliteTable(
  'referenced_events',
  {
    id: text('id').primaryKey(),
    event: text('event', { mode: 'json' }).$type<NostrEvent>().notNull(),
    fetchedAt: integer('fetched_at').notNull(),
  },
  (t) => [index('idx_referenced_events_fetched_at').on(t.fetchedAt)],
);
