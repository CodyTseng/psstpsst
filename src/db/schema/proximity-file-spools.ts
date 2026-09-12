import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Durable encrypted blobs awaiting one or more Proximity-signed Blossom uploads. */
export const proximityFileSpools = sqliteTable(
  'proximity_file_spools',
  {
    accountPubkey: text('account_pubkey').notNull(),
    x: text('x').notNull(),
    ox: text('ox').notNull(),
    localName: text('local_name').notNull(),
    cipherSize: integer('cipher_size').notNull(),
    plainSize: integer('plain_size').notNull(),
    keyHex: text('key_hex').notNull(),
    nonceHex: text('nonce_hex').notNull(),
    mime: text('mime').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.accountPubkey, t.x] })],
);
