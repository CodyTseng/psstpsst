import Database from 'better-sqlite3';

import migrations from '../migrations/migrations';

function runMigration(database: Database.Database, source: string): void {
  for (const statement of source.split('--> statement-breakpoint')) {
    if (statement.trim()) database.exec(statement);
  }
}

describe('group messaging migration', () => {
  test('repairs equal-millisecond read cursors and initializes activity without unread churn', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const entries = Object.entries(migrations.migrations);
    for (const [name, source] of entries) {
      if (name === 'm0050') break;
      runMigration(sqlite, source);
    }

    const account = 'a'.repeat(64);
    const peer = 'b'.repeat(64);
    const rumor = (id: string, createdAt: number, orderAt: number) => ({
      id,
      pubkey: peer,
      kind: 14,
      content: id,
      created_at: createdAt,
      tags: [['p', account]],
      orderAt,
    });
    for (const [id, createdAt, orderAt] of [['z', 1, 1_000], ['a', 1, 1_000], ['x', 2, 2_000]] as const) {
      const event = rumor(id, createdAt, orderAt);
      sqlite.prepare(`
        INSERT INTO messages (
          account_pubkey, id, conversation_key, sender_pubkey, kind, content,
          created_at, order_at, tags, rumor
        ) VALUES (?, ?, ?, ?, 14, ?, ?, ?, ?, ?)
      `).run(account, id, peer, peer, id, createdAt, orderAt, JSON.stringify(event.tags), JSON.stringify(event));
    }
    sqlite.prepare(`
      INSERT INTO conversations (
        account_pubkey, conversation_key, last_message_at,
        last_message_order_at, last_message_id, unread_count,
        last_read_at, last_read_order_at, last_read_message_id
      ) VALUES (?, ?, 2, 2000, 'x', 0, 1, 1000, 'z')
    `).run(account, peer);
    sqlite.prepare(`
      INSERT INTO message_drafts (account_pubkey, conversation_key, text, updated_at)
      VALUES (?, ?, 'draft', 3)
    `).run(account, peer);

    runMigration(sqlite, migrations.migrations.m0050);
    const row = sqlite.prepare(`
      SELECT created_at, created_order_at, updated_at, updated_order_at,
             last_read_message_id, unread_count
      FROM conversations
      WHERE account_pubkey = ? AND conversation_key = ?
    `).get(account, peer) as Record<string, number | string>;
    expect(row).toEqual({
      created_at: 1,
      created_order_at: 1_000,
      updated_at: 3,
      updated_order_at: 3_000,
      last_read_message_id: 'a',
      unread_count: 1,
    });
    sqlite.close();
  });
});
