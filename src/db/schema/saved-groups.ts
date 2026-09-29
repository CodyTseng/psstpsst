import { primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Private, account-scoped group ids the user explicitly keeps in their group directory. */
export const savedGroups = sqliteTable(
  'saved_groups',
  {
    accountPubkey: text('account_pubkey').notNull(),
    groupId: text('group_id').notNull(),
  },
  (table) => [primaryKey({ columns: [table.accountPubkey, table.groupId] })],
);
