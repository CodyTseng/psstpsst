import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { Event } from 'nostr-tools';

/** Durable FIFO work for relay delivery. A row has no running state: existing
 * means unfinished, and completion deletes it. */
export const relayOutboxJobs = sqliteTable(
  'relay_outbox_jobs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountPubkey: text('account_pubkey').notNull(),
    messageId: text('message_id').notNull(),
    scope: text('scope', {
      enum: ['all_recipient_relays', 'selected_targets'],
    }).notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_relay_outbox_fifo').on(t.accountPubkey, t.id),
    index('idx_relay_outbox_message').on(t.accountPubkey, t.messageId),
  ],
);

/** A target row exists only while that exact recipient/relay publication is
 * unfinished. Settling it updates the durable copy and deletes this row in one
 * transaction. */
export const relayOutboxJobTargets = sqliteTable(
  'relay_outbox_job_targets',
  {
    jobId: integer('job_id')
      .notNull()
      .references(() => relayOutboxJobs.id, { onDelete: 'cascade' }),
    recipientPubkey: text('recipient_pubkey').notNull(),
    relayUrl: text('relay_url').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.jobId, t.recipientPubkey, t.relayUrl] }),
    index('idx_relay_outbox_target_job').on(t.jobId),
  ],
);

/** One signed gift wrap per recipient and job, reused by every relay target and
 * across process recovery. It is deleted as soon as that recipient has no
 * unfinished targets in the job. */
export const relayOutboxPayloads = sqliteTable(
  'relay_outbox_payloads',
  {
    jobId: integer('job_id')
      .notNull()
      .references(() => relayOutboxJobs.id, { onDelete: 'cascade' }),
    recipientPubkey: text('recipient_pubkey').notNull(),
    giftWrap: text('gift_wrap', { mode: 'json' }).$type<Event>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.jobId, t.recipientPubkey] })],
);
