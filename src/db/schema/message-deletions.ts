import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import type { Rumor } from './types';

export const messageDeletions = sqliteTable('message_deletions', {
  accountPubkey: text('account_pubkey').notNull(),
  id: text('id').notNull(),
  orderAt: integer('order_at').notNull(),
  rumor: text('rumor', { mode: 'json' }).$type<Rumor>().notNull(),
  pendingTargetId: text('pending_target_id'),
}, (t) => [
  primaryKey({ columns: [t.accountPubkey, t.id] }),
  index('message_deletions_pending_target_idx')
    .on(t.accountPubkey, t.pendingTargetId)
    .where(sql`${t.pendingTargetId} IS NOT NULL`),
]);
