import { foreignKey, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { messages } from './messages';

/** Pending delivery only. Claiming removes a row atomically across runtimes. */
export const notificationEvents = sqliteTable('notification_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountPubkey: text('account_pubkey').notNull(),
  conversationKey: text('conversation_key').notNull(),
  messageId: text('message_id').notNull(),
  kind: text('kind', { enum: ['message', 'request'] }).notNull(),
  target: text('target', { enum: ['foreground', 'system'] }).notNull(),
  createdAt: integer('created_at').notNull(),
}, (t) => [
  uniqueIndex('idx_notification_event_message').on(t.accountPubkey, t.messageId),
  index('idx_notification_event_delivery').on(t.accountPubkey, t.target, t.id),
  index('idx_notification_event_expiry').on(t.createdAt),
  foreignKey({ columns: [t.accountPubkey, t.messageId], foreignColumns: [messages.accountPubkey, messages.id] }).onDelete('cascade'),
]);
