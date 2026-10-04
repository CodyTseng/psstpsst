import { DatabaseSync } from 'node:sqlite';

import migrations from '../migrations/migrations';

test('repairs updated timestamps using the owning account and last-message id', () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec(`
      CREATE TABLE conversations (
        account_pubkey TEXT, conversation_key TEXT,
        created_at INTEGER, created_order_at INTEGER,
        updated_at INTEGER, updated_order_at INTEGER,
        last_message_id TEXT, last_message_at INTEGER, last_message_order_at INTEGER
      );
      CREATE TABLE messages (
        account_pubkey TEXT, id TEXT, created_at INTEGER, order_at INTEGER,
        PRIMARY KEY (account_pubkey, id)
      );
      INSERT INTO messages VALUES ('account', 'shared', 100, 100123);
      INSERT INTO messages VALUES ('other-account', 'shared', 200, 200456);
      INSERT INTO conversations VALUES ('account', 'peer', 1, 1000, 999, 999000, 'shared', 99, 99000);
      INSERT INTO conversations VALUES ('other-account', 'peer', 2, 2000, 999, 999000, 'shared', 99, 99000);
      INSERT INTO conversations VALUES ('account', 'empty', 300, 300789, 999, 999000, NULL, NULL, NULL);
    `);
    sqlite.exec(migrations.migrations.m0054);
    const rows = sqlite.prepare(`
      SELECT account_pubkey, conversation_key, updated_at, updated_order_at, last_message_id
      FROM conversations ORDER BY account_pubkey, conversation_key
    `).all();
    expect(rows).toEqual([
      { account_pubkey: 'account', conversation_key: 'empty', updated_at: 300, updated_order_at: 300789, last_message_id: null },
      { account_pubkey: 'account', conversation_key: 'peer', updated_at: 100, updated_order_at: 100123, last_message_id: 'shared' },
      { account_pubkey: 'other-account', conversation_key: 'peer', updated_at: 200, updated_order_at: 200456, last_message_id: 'shared' },
    ]);
  } finally {
    sqlite.close();
  }
});
