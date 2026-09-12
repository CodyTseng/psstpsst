import { foreignKey, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { messages } from './messages';

export type MessageMediaSource = 'attachment' | 'embedded';
export type MessageMediaKind = 'image' | 'video' | 'audio' | 'file';

/**
 * Per-message media references used by conversation media browsing and local
 * file reference counting. Protocol URL-to-content identity and on-disk state
 * live in `attachment_urls` and `stored_files`, respectively.
 */
export const messageMedia = sqliteTable(
  'message_media',
  {
    accountPubkey: text('account_pubkey').notNull(),
    messageId: text('message_id').notNull(),
    conversationKey: text('conversation_key').notNull(),
    url: text('url').notNull(),
    source: text('source', { enum: ['attachment', 'embedded'] }).notNull(),
    mediaKind: text('media_kind', { enum: ['image', 'video', 'audio', 'file'] }).notNull(),
    /** Images and videos participate in the conversation gallery. */
    gallery: integer('gallery', { mode: 'boolean' }).notNull(),
    createdAt: integer('created_at').notNull(),
    orderAt: integer('order_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.accountPubkey, t.messageId, t.url] }),
    foreignKey({
      columns: [t.accountPubkey, t.messageId],
      foreignColumns: [messages.accountPubkey, messages.id],
    }).onDelete('cascade'),
    index('idx_msg_media_gallery_time').on(
      t.accountPubkey,
      t.conversationKey,
      t.gallery,
      t.orderAt,
      t.messageId,
      t.url,
    ),
    index('idx_msg_media_source_url').on(t.source, t.url),
  ],
);
