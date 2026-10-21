import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { accounts } from './accounts';
/** Cached addresses are independent of shortcut membership and browsing recency. */
export const exploreEntries = sqliteTable('explore_entries', {
  accountPubkey: text('account_pubkey').notNull().references(() => accounts.pubkey, { onDelete: 'cascade' }),
  sourceId: text('source_id').notNull(), address: text('address').notNull(), title: text('title').notNull(),
  kind: text('kind').notNull(), servers: text('servers').notNull().default('[]'), manifest: text('manifest'),
}, (t) => [primaryKey({ columns: [t.accountPubkey, t.sourceId] })]);
export const exploreShortcuts = sqliteTable('explore_shortcuts', {
  accountPubkey: text('account_pubkey').notNull().references(() => accounts.pubkey, { onDelete: 'cascade' }),
  sourceId: text('source_id').notNull(), position: integer('position').notNull(),
  reference: text('reference', { mode: 'json' }).$type<string[]>(),
}, (t) => [primaryKey({ columns: [t.accountPubkey, t.sourceId] }), index('explore_shortcut_order').on(t.accountPubkey, t.position)]);
export const exploreHistory = sqliteTable('explore_history', {
  accountPubkey: text('account_pubkey').notNull().references(() => accounts.pubkey, { onDelete: 'cascade' }),
  sourceId: text('source_id').notNull(), lastUsedAt: integer('last_used_at').notNull(),
}, (t) => [primaryKey({ columns: [t.accountPubkey, t.sourceId] }), index('explore_history_order').on(t.accountPubkey, t.lastUsedAt)]);

/** Browser capability decisions are independent of event-signing grants. */
export const browserAuthorizations = sqliteTable('browser_authorizations', {
  accountPubkey: text('account_pubkey').notNull().references(() => accounts.pubkey, { onDelete: 'cascade' }),
  sourceId: text('source_id').notNull(), resource: text('resource').notNull(),
  decision: text('decision', { enum: ['allow', 'deny'] }).notNull(),
  expiresAt: integer('expires_at'), updatedAt: integer('updated_at').notNull(),
}, (t) => [primaryKey({ columns: [t.accountPubkey, t.sourceId, t.resource] })]);
