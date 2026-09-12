import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

import type { NostrEvent } from './types';

export const encryptionKeyAnnouncements = sqliteTable('encryption_key_announcements', {
  pubkey: text('pubkey').primaryKey(),
  encryptionPubkey: text('encryption_pubkey').notNull(),
  eventId: text('event_id').notNull(),
  eventCreatedAt: integer('event_created_at').notNull(),
  rawEvent: text('raw_event', { mode: 'json' }).$type<NostrEvent>().notNull(),
  fetchedAt: integer('fetched_at').notNull(),
});
