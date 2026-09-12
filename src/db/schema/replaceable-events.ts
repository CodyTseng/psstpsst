import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import type { NostrEvent } from './types';

/**
 * Generic cache of Nostr replaceable (kind 0, 3, 10000–19999) and addressable
 * (kind 30000–39999) events, keyed by (pubkey, kind, dTag). `dTag` is '' for
 * plain replaceable kinds. A null `event` is a negative-cache row recording
 * that a relay lookup found nothing, so `fetchedAt` still gates re-queries.
 */
export const replaceableEvents = sqliteTable(
  'replaceable_events',
  {
    pubkey: text('pubkey').notNull(),
    kind: integer('kind').notNull(),
    dTag: text('d_tag').notNull().default(''),
    event: text('event', { mode: 'json' }).$type<NostrEvent>(),
    createdAt: integer('created_at'),
    fetchedAt: integer('fetched_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.pubkey, t.kind, t.dTag] }),
    index('idx_replaceable_events_pubkey_kind').on(t.pubkey, t.kind),
  ],
);
