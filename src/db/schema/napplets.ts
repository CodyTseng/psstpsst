import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { accounts } from './accounts';

export const nappletInstallations = sqliteTable(
  'napplet_installations',
  {
    accountPubkey: text('account_pubkey')
      .notNull()
      .references(() => accounts.pubkey, { onDelete: 'cascade' }),
    appKey: text('app_key').notNull(),
    manifest: text('manifest').notNull(),
    artifactHash: text('artifact_hash').notNull(),
    previousManifest: text('previous_manifest'),
    lastUsedAt: integer('last_used_at'),
    pinnedAt: integer('pinned_at'),
  },
  (t) => [
    primaryKey({ columns: [t.accountPubkey, t.appKey] }),
    index('napplet_recent').on(t.accountPubkey, t.lastUsedAt),
  ],
);

export const nappletData = sqliteTable(
  'napplet_data',
  {
    accountPubkey: text('account_pubkey')
      .notNull()
      .references(() => accounts.pubkey, { onDelete: 'cascade' }),
    appKey: text('app_key').notNull(),
    artifactHash: text('artifact_hash').notNull(),
    bucket: text('bucket').notNull(),
    key: text('key').notNull(),
    value: text('value').notNull(),
    bytes: integer('bytes').notNull(),
  },
  (t) => [primaryKey({ columns: [t.accountPubkey, t.appKey, t.artifactHash, t.bucket, t.key] })],
);

export const nappletUsage = sqliteTable(
  'napplet_usage',
  {
    accountPubkey: text('account_pubkey')
      .notNull()
      .references(() => accounts.pubkey, { onDelete: 'cascade' }),
    appKey: text('app_key').notNull(),
    artifactHash: text('artifact_hash').notNull(),
    bucket: text('bucket').notNull(),
    bytes: integer('bytes').notNull().default(0),
    count: integer('count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.accountPubkey, t.appKey, t.artifactHash, t.bucket] })],
);
