import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Device-local upload attempts that have not become stored messages yet.
 * Metadata lives in SQLite; the source blob is staged separately under the
 * app's persistent document directory and referenced by relative name. */
export const pendingAttachments = sqliteTable(
  'pending_attachments',
  {
    accountPubkey: text('account_pubkey').notNull(),
    tempId: text('temp_id').notNull(),
    conversationKey: text('conversation_key').notNull(),
    localName: text('local_name').notNull(),
    mime: text('mime').notNull(),
    width: integer('width'),
    height: integer('height'),
    name: text('name'),
    size: integer('size'),
    durationSec: integer('duration_sec'),
    waveform: text('waveform', { mode: 'json' }).$type<number[]>(),
    imageQuality: text('image_quality', { enum: ['optimized', 'original'] }),
    messageOrderAt: integer('message_order_at'),
    status: text('status', {
      enum: [
        'preparing',
        'encrypting',
        'uploading',
        'publishing',
        'paused',
        'stopped',
        'failed',
      ],
    }).notNull(),
    startedAt: integer('started_at'),
    replyToId: text('reply_to_id'),
    error: text('error'),
  },
  (t) => [primaryKey({ columns: [t.accountPubkey, t.tempId] })],
);
