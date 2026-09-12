import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';

/**
 * Pubkeys the account has blocked. A blocked user's incoming gift wraps are
 * dropped **before** they're decrypted into the store (see `dm.service`
 * ingestion), and blocking soft-deletes their existing conversation — so a
 * blocked person never reaches the inbox again. The local table is the UI
 * source of truth; it syncs privately across the user's own devices via a
 * NIP-51 follow set (kind 30000, `d=psstpsst-blocked`) whose members are
 * NIP-44-encrypted to self, so who you blocked is never exposed.
 */
export const blockedUsers = sqliteTable(
  'blocked_users',
  {
    accountPubkey: text('account_pubkey').notNull(),
    pubkey: text('pubkey').notNull(),
    blockedAt: integer('blocked_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.accountPubkey, t.pubkey] }),
    index('idx_blocked_account').on(t.accountPubkey),
  ],
);
