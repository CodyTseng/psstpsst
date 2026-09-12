import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

/**
 * Gift-wrap (kind 1059) event ids we've already unwrapped, so we never decrypt
 * the same one twice. On (re)connect a relay replays its whole history matching
 * our subscription; NIP-44 + schnorr decryption is CPU-heavy, so we skip any id
 * recorded here *before* decrypting. Keyed by the gift-wrap event id (globally
 * unique); `accountPubkey` is carried so the rows can be purged with an account.
 */
export const processedGiftWraps = sqliteTable(
  'processed_gift_wraps',
  {
    id: text('id').primaryKey(),
    accountPubkey: text('account_pubkey').notNull(),
    processedAt: integer('processed_at').notNull(),
  },
  (t) => [index('idx_pgw_account').on(t.accountPubkey)],
);
