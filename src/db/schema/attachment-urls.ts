import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * A protocol-level mapping from a kind-15 attachment URL to the plaintext
 * content hash (`ox`). It deliberately contains no message, conversation, or
 * local-download state.
 */
export const attachmentUrls = sqliteTable(
  'attachment_urls',
  {
    url: text('url').primaryKey(),
    ox: text('ox').notNull(),
  },
  (t) => [index('idx_attachment_urls_ox').on(t.ox)],
);
