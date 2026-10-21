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

it('migrates existing private revisions and schedules local favorites for initial sync', () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec("PRAGMA foreign_keys=ON; CREATE TABLE accounts(pubkey TEXT PRIMARY KEY); INSERT INTO accounts VALUES ('a');");
    sqlite.exec(migrations.migrations.m0056);
    sqlite.exec(migrations.migrations.m0062);
    sqlite.exec("INSERT INTO private_list_sync_state(account_pubkey,d_tag,revision,dirty,event_id) VALUES ('a','psstpsst-muted',4,1,'old'); INSERT INTO explore_shortcuts VALUES ('a','app',0);");
    sqlite.exec(migrations.migrations.m0070);
    expect(sqlite.prepare('SELECT kind,d_tag,revision,dirty,event_id FROM private_list_sync_state ORDER BY kind').all()).toEqual([
      { kind: 30000, d_tag: 'psstpsst-muted', revision: 4, dirty: 1, event_id: 'old' },
      { kind: 30267, d_tag: 'psstpsst-favorites', revision: 1, dirty: 1, event_id: null },
    ]);
    expect(sqlite.prepare('SELECT source_id,position,reference FROM explore_shortcuts').get()).toEqual({ source_id: 'app', position: 0, reference: null });
    sqlite.exec("INSERT INTO private_list_sync_state(account_pubkey,kind,d_tag) VALUES ('a',30267,'psstpsst-muted'); DELETE FROM accounts;");
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM private_list_sync_state').get()).toEqual({ n: 0 });
  } finally { sqlite.close(); }
});
