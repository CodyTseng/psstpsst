import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Latest authenticated encryption-key evidence for a peer identity. Private
 * seal observations and public kind-10044 announcements compete by their
 * signed event time, never by local receive order.
 */
export const observedPeerEncryptionKeys = sqliteTable('observed_peer_encryption_keys', {
  peerPubkey: text('peer_pubkey').primaryKey(),
  encryptionPubkey: text('encryption_pubkey').notNull(),
  source: text('source', { enum: ['seal', 'kind-10044'] }).notNull(),
  evidenceId: text('evidence_id').notNull(),
  evidenceCreatedAt: integer('evidence_created_at').notNull(),
  /** Local time of the last successful kind-10044 check, including an empty result. */
  announcementCheckedAt: integer('announcement_checked_at'),
  observedAt: integer('observed_at').notNull(),
});
