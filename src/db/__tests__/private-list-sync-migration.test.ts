import { DatabaseSync } from 'node:sqlite';

import migrations from '../migrations/migrations';

it('isolates durable list revisions by account and list, and cascades account removal', () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec("PRAGMA foreign_keys = ON; CREATE TABLE accounts (pubkey TEXT PRIMARY KEY); INSERT INTO accounts VALUES ('a'), ('b');");
    sqlite.exec(migrations.migrations.m0056);
    const insert = sqlite.prepare('INSERT INTO private_list_sync_state (account_pubkey, d_tag, revision, dirty) VALUES (?, ?, ?, 1)');
    insert.run('a', 'psstpsst-muted', 2);
    insert.run('a', 'psstpsst-blocked', 3);
    insert.run('b', 'psstpsst-muted', 4);
    expect(() => insert.run('a', 'psstpsst-muted', 5)).toThrow();
    sqlite.prepare('DELETE FROM accounts WHERE pubkey = ?').run('a');
    expect(sqlite.prepare('SELECT account_pubkey, d_tag, revision, dirty FROM private_list_sync_state').all())
      .toEqual([{ account_pubkey: 'b', d_tag: 'psstpsst-muted', revision: 4, dirty: 1 }]);
    expect(migrations.journal.entries[56]?.tag).toBe('0056_private-list-sync-state');
  } finally { sqlite.close(); }
});
