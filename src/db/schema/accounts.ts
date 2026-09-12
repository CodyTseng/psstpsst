import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const accounts = sqliteTable(
  'accounts',
  {
    pubkey: text('pubkey').primaryKey(),
    signerType: text('signer_type', { enum: ['nsec', 'nip46', 'generated'] }).notNull(),
    signerPayload: text('signer_payload'),
    encryptionPubkey: text('encryption_pubkey'),
    /** Only newly generated identities may finish their first setup without remote lookup. */
    localSetupPending: integer('local_setup_pending', { mode: 'boolean' }).notNull().default(false),
    addedAt: integer('added_at').notNull(),
    lastActiveAt: integer('last_active_at'),
    /** Manual list position (ascending), so the account list stays put for blind
     * operation — switching only touches `lastActiveAt`, never this. New accounts
     * append (seeded with `addedAt`, which always sorts after a reordered set's
     * small indices); the account manager rewrites it on drag-reorder. */
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('idx_accounts_last_active').on(t.lastActiveAt)],
);
