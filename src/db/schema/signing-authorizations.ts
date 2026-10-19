import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { accounts } from './accounts';

export const signingAuthorizations = sqliteTable('signing_authorizations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountPubkey: text('account_pubkey').notNull().references(() => accounts.pubkey, { onDelete: 'cascade' }),
  sourceId: text('source_id').notNull(),
  operation: text('operation').notNull().default('publish'),
  recipient: text('recipient').notNull().default(''),
  destinations: text('destinations').notNull().default('[]'),
  kind: integer('kind').notNull(),
  dTag: text('d_tag').notNull().default(''),
  decision: text('decision', { enum: ['allow', 'deny'] }).notNull(),
  expiresAt: integer('expires_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (t) => [uniqueIndex('signing_authorization_scope').on(t.accountPubkey, t.sourceId, t.operation, t.kind, t.dTag, t.recipient, t.destinations)]);

export const signingActivity = sqliteTable('signing_activity', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountPubkey: text('account_pubkey').notNull().references(() => accounts.pubkey, { onDelete: 'cascade' }),
  sourceId: text('source_id').notNull(),
  operation: text('operation').notNull(),
  kind: integer('kind').notNull(),
  decision: text('decision', { enum: ['allowed', 'automatic', 'denied'] }).notNull(),
  at: integer('at').notNull(),
}, (t) => [index('signing_activity_source').on(t.accountPubkey, t.sourceId, t.id)]);
