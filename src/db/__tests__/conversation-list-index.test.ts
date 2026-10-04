import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { and, desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/sqlite-proxy';

import migrations from '../migrations/migrations';
import { conversations, messages } from '../schema';

describe('conversation list indexes', () => {
  const sqlite = new DatabaseSync(':memory:');
  const db = drizzle(async () => ({ rows: [] }));

  beforeAll(() => {
    for (const source of Object.values(migrations.migrations)) {
      for (const statement of source.split('--> statement-breakpoint')) {
        if (statement.trim()) sqlite.exec(statement);
      }
    }
  });
  afterAll(() => sqlite.close());

  it.each([true, false])('filters and orders hasReplied=%s without a temporary sort', (hasReplied) => {
    const query = db
      .select({ conversation: conversations, content: messages.content })
      .from(conversations)
      .leftJoin(messages, and(
        eq(messages.accountPubkey, conversations.accountPubkey),
        eq(messages.id, conversations.lastMessageId),
      ))
      .where(and(
        eq(conversations.accountPubkey, 'account'),
        eq(conversations.deleted, false),
        eq(conversations.hasReplied, hasReplied),
      ))
      .orderBy(desc(conversations.pinned), desc(conversations.updatedOrderAt), desc(conversations.conversationKey))
      .toSQL();
    const plan = sqlite.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).all(...query.params as SQLInputValue[])
      .map((row) => String(row.detail));

    expect(plan.some((step) => step.includes('idx_conv_inbox') &&
      step.includes('account_pubkey=? AND deleted=? AND has_replied=?'))).toBe(true);
    expect(plan.some((step) => step.includes('TEMP B-TREE'))).toBe(false);
    expect(plan.some((step) => step.includes('sqlite_autoindex_messages_1'))).toBe(true);
  });

  it('retains indexed chronology for lists that do not order by pins', () => {
    const query = db.select().from(conversations)
      .where(eq(conversations.accountPubkey, 'account'))
      .orderBy(desc(conversations.updatedOrderAt), desc(conversations.conversationKey))
      .toSQL();
    const plan = sqlite.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).all(...query.params as SQLInputValue[])
      .map((row) => String(row.detail));
    expect(plan.some((step) => step.includes('idx_conv_activity'))).toBe(true);
    expect(plan.some((step) => step.includes('TEMP B-TREE'))).toBe(false);

    const indexes = sqlite.prepare("PRAGMA index_list('conversations')").all();
    expect(indexes.some((row) => row.name === 'idx_conv_last_msg')).toBe(false);
    expect(indexes.some((row) => row.name === 'idx_conv_backup_owner')).toBe(true);
  });
});
