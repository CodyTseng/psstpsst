import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Non-secret, device-wide settings that do not belong in the OS keychain. */
export const devicePreferences = sqliteTable('device_preferences', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
