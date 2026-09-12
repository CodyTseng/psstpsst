import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Per-server retry ledger for an encrypted Nearby attachment spool. */
export const proximityFileUploads = sqliteTable(
  'proximity_file_uploads',
  {
    accountPubkey: text('account_pubkey').notNull(),
    x: text('x').notNull(),
    server: text('server').notNull(),
    status: text('status', { enum: ['queued', 'uploading', 'paused', 'uploaded'] }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: integer('next_attempt_at'),
    lastError: text('last_error'),
    uploadedAt: integer('uploaded_at'),
  },
  (t) => [
    primaryKey({ columns: [t.accountPubkey, t.x, t.server] }),
    index('idx_proximity_file_upload_drain').on(
      t.accountPubkey,
      t.status,
      t.nextAttemptAt,
    ),
  ],
);
