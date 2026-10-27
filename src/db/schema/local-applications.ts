import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';
import { accounts } from './accounts';

/** Unsigned installations are account-owned and never enter the public event cache. */
export const localApplications = sqliteTable('local_applications', {
  accountPubkey: text('account_pubkey').notNull().references(() => accounts.pubkey, { onDelete: 'cascade' }),
  appId: text('app_id').notNull(),
  version: text('version').notNull(),
  installer: text('installer').notNull(),
  entry: text('entry').notNull(),
  desktopPosition: integer('desktop_position'),
}, t => [primaryKey({ columns: [t.accountPubkey, t.appId] })]);
