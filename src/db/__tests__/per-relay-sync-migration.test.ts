import { DatabaseSync } from 'node:sqlite';

import migrations from '../migrations/migrations';

it('discards unproven global coverage and isolates relay frontiers without losing dedup records', () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec(`
      CREATE TABLE sync_cursors (account_pubkey TEXT PRIMARY KEY, forward_since INTEGER, backward_until INTEGER, updated_at INTEGER NOT NULL);
      INSERT INTO sync_cursors VALUES ('a', 1791555375, 0, 1791555383);
      CREATE TABLE processed_gift_wraps (id TEXT PRIMARY KEY, account_pubkey TEXT, processed_at INTEGER);
      INSERT INTO processed_gift_wraps VALUES ('seen', 'a', 1);
    `);
    sqlite.exec(migrations.migrations.m0057);
    expect(sqlite.prepare('SELECT * FROM sync_cursors').all()).toEqual([]);
    expect(sqlite.prepare('SELECT id FROM processed_gift_wraps').all()).toEqual([{ id: 'seen' }]);
    const insert = sqlite.prepare('INSERT INTO sync_cursors VALUES (?, ?, ?, ?, 1)');
    insert.run('a', 'wss://one.example', 100, 0);
    insert.run('a', 'wss://two.example', 50, 25);
    insert.run('b', 'wss://one.example', 10, 5);
    expect(() => insert.run('a', 'wss://one.example', 200, 0)).toThrow();
    sqlite.prepare('DELETE FROM sync_cursors WHERE account_pubkey = ?').run('a');
    expect(sqlite.prepare('SELECT account_pubkey, relay_url FROM sync_cursors').all())
      .toEqual([{ account_pubkey: 'b', relay_url: 'wss://one.example' }]);
  } finally { sqlite.close(); }
});
