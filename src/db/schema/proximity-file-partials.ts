import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Durable, independently resumable plaintext-BLE and ciphertext-Blossom partials. */
export const proximityFilePartials = sqliteTable(
  'proximity_file_partials',
  {
    accountPubkey: text('account_pubkey').notNull(),
    rumorId: text('rumor_id').notNull(),
    representation: text('representation', { enum: ['plain', 'cipher'] }).notNull(),
    peerPubkey: text('peer_pubkey').notNull(),
    x: text('x').notNull(),
    ox: text('ox').notNull(),
    expectedSize: integer('expected_size').notNull(),
    offset: integer('offset').notNull(),
    localName: text('local_name').notNull(),
    mime: text('mime').notNull(),
    url: text('url').notNull(),
    lastProgressAt: integer('last_progress_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.accountPubkey, t.rumorId, t.representation] }),
    index('idx_proximity_file_partial_expiry').on(t.accountPubkey, t.lastProgressAt),
  ],
);
