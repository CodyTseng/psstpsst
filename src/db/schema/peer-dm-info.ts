import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

/**
 * A peer's NIP-17 DM endpoint — their **encryption pubkey** (kind 10044) and
 * **DM relays** (kind 10050) — plus when we checked (`checkedAt`, unix seconds).
 * A row exists **only for a reachable peer**: both columns are non-null, so the
 * row's mere presence means "we can DM them". An unreachable peer has **no row**,
 * so the composer re-checks them on every open — catching the moment they
 * publish the missing piece. Persisted so it survives restarts: the chat
 * composer reads it asynchronously but silently (no "Checking…" flash) and
 * skips revalidating a reachable peer checked within the TTL.
 */
export const peerDmInfo = sqliteTable('peer_dm_info', {
  pubkey: text('pubkey').primaryKey(),
  encryptionPubkey: text('encryption_pubkey').notNull(),
  dmRelays: text('dm_relays', { mode: 'json' }).$type<string[]>().notNull(),
  checkedAt: integer('checked_at').notNull(),
});
