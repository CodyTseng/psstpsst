import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { accounts } from './accounts';

/** First-use consent and full trust, independent of editable per-operation rules. */
export const appAuthorizationPreferences = sqliteTable('app_authorization_preferences', {
  accountPubkey: text('account_pubkey').notNull().references(() => accounts.pubkey, { onDelete: 'cascade' }),
  sourceId: text('source_id').notNull(),
  fullyTrusted: integer('fully_trusted', { mode: 'boolean' }).notNull().default(false),
}, (t) => [uniqueIndex('app_authorization_preference_source').on(t.accountPubkey, t.sourceId)]);
