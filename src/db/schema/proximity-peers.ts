import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Stable peer profiles learned from authenticated nearby sessions. */
export const proximityPeers = sqliteTable(
  'proximity_peers',
  {
    accountPubkey: text('account_pubkey').notNull(),
    proximityPubkey: text('proximity_pubkey').notNull(),
    displayName: text('display_name').notNull(),
    /** Private nickname assigned on this device. It must not be replaced by
     * the peer's authenticated display name on a later connection. */
    nickname: text('nickname'),
    lastSeenAt: integer('last_seen_at').notNull(),
    /** Local consent for automatic proximity authentication. Independent from
     * conversation history so deleting a chat does not forget the device. */
    connectedAt: integer('connected_at'),
    /** Device-local proximity block state. This is intentionally separate from
     * the account's relay-synced blocked-users list. */
    blockedAt: integer('blocked_at'),
    /** A terminal remote AUTH failure. Automatic authentication remains
     * suppressed until the user explicitly retries the connection. */
    connectionFailure: text('connection_failure', { enum: ['rejected', 'failed'] }),
  },
  (t) => [
    primaryKey({ columns: [t.accountPubkey, t.proximityPubkey] }),
    index('idx_proximity_peer_seen').on(t.accountPubkey, t.lastSeenAt),
  ],
);
