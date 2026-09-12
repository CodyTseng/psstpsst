import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Files currently present in the app-owned, content-addressed attachment
 * directory. The filename is derived from `ox` and `mime`; row existence is the
 * on-disk state, so deleting a file also deletes its row.
 */
export const storedFiles = sqliteTable('stored_files', {
  ox: text('ox').primaryKey(),
  mime: text('mime').notNull(),
  /** Plaintext byte length, when known. */
  size: integer('size'),
  downloadedAt: integer('downloaded_at').notNull(),
});
