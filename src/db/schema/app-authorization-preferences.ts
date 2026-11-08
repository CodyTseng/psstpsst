import { sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { accounts } from './accounts';

/** Application authorization policy, independent of explicit per-operation decisions. */
export const appAuthorizationPreferences = sqliteTable('app_authorization_preferences', {
  accountPubkey: text('account_pubkey').notNull().references(() => accounts.pubkey, { onDelete: 'cascade' }),
  sourceId: text('source_id').notNull(),
  level: text('level', { enum: ['manual', 'routine', 'trusted'] }).notNull(),
}, (t) => [uniqueIndex('app_authorization_preference_source').on(t.accountPubkey, t.sourceId)]);
