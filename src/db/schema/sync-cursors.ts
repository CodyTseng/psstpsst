import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

export type ForwardSyncScan = {
  through: number;
  floor: number;
  nextUntil: number;
};

export const syncCursors = sqliteTable('sync_cursors', {
  accountPubkey: text('account_pubkey').notNull(),
  relayUrl: text('relay_url').notNull(),
  forwardSince: integer('forward_since'),
  backwardUntil: integer('backward_until'),
  pendingForward: text('pending_forward', { mode: 'json' }).$type<ForwardSyncScan>(),
  updatedAt: integer('updated_at').notNull(),
}, (t) => [primaryKey({ columns: [t.accountPubkey, t.relayUrl] })]);
