import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { accounts } from './accounts';

export const signingAuthorizations = sqliteTable('signing_authorizations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountPubkey: text('account_pubkey').notNull().references(() => accounts.pubkey, { onDelete: 'cascade' }),
  sourceId: text('source_id').notNull(),
  operation: text('operation').notNull().default('publish'),
  /** Legacy qualifier retained for migrations; current signer rules use an empty value. */
  recipient: text('recipient').notNull().default(''),
  /** App action decisions leave destinations empty; request targets remain transient. */
  destinations: text('destinations').notNull().default('[]'),
  kind: integer('kind').notNull(),
  /** Operation-specific permission qualifier; addressable events use their d-tag value. */
  scopeKey: text('scope_key').notNull().default(''),
  decision: text('decision', { enum: ['allow', 'deny'] }).notNull(),
  expiresAt: integer('expires_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (t) => [
  uniqueIndex('signing_authorization_scope').on(t.accountPubkey, t.sourceId, t.operation, t.kind, t.scopeKey, t.recipient, t.destinations),
  uniqueIndex('signing_relay_auth_scope').on(t.accountPubkey, t.sourceId, t.scopeKey).where(sql`${t.operation} = 'relay-auth'`),
  check('signing_authorization_kind', sql`(${t.operation} IN ('get-public-key', 'nip04-encrypt', 'nip04-decrypt', 'nip44-encrypt', 'nip44-decrypt') AND ${t.kind} = -1)
    OR (${t.operation} NOT IN ('get-public-key', 'nip04-encrypt', 'nip04-decrypt', 'nip44-encrypt', 'nip44-decrypt') AND ${t.kind} BETWEEN 0 AND 65535)`),
]);

export const signingActivity = sqliteTable('signing_activity', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountPubkey: text('account_pubkey').notNull().references(() => accounts.pubkey, { onDelete: 'cascade' }),
  sourceId: text('source_id').notNull(),
  operation: text('operation').notNull(),
  kind: integer('kind').notNull(),
  decision: text('decision', { enum: ['allowed', 'automatic', 'denied'] }).notNull(),
  at: integer('at').notNull(),
}, (t) => [index('signing_activity_source').on(t.accountPubkey, t.sourceId, t.id)]);
