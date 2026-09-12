import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

import type { NostrEvent } from './types';

export const profiles = sqliteTable('profiles', {
  pubkey: text('pubkey').primaryKey(),
  name: text('name'),
  displayName: text('display_name'),
  picture: text('picture'),
  nip05: text('nip05'),
  lud06: text('lud06'),
  lud16: text('lud16'),
  about: text('about'),
  rawEvent: text('raw_event', { mode: 'json' }).$type<NostrEvent>(),
  fetchedAt: integer('fetched_at').notNull(),
});
