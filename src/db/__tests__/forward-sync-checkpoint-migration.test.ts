import { DatabaseSync } from 'node:sqlite';

import migrations from '../migrations/migrations';

it('adds checkpoints without resetting existing account/relay frontiers', () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec(migrations.migrations.m0057.replace('DROP TABLE `sync_cursors`;', ''));
    sqlite.exec(`INSERT INTO sync_cursors VALUES
      ('a', 'wss://one.example/', 100, 20, 1),
      ('a', 'wss://two.example/', 200, 0, 1),
      ('b', 'wss://one.example/', 300, 0, 1);`);
    sqlite.exec(migrations.migrations.m0058);
    expect(sqlite.prepare('SELECT account_pubkey, relay_url, forward_since, backward_until, pending_forward FROM sync_cursors').all())
      .toEqual([
        { account_pubkey: 'a', relay_url: 'wss://one.example/', forward_since: 100, backward_until: 20, pending_forward: null },
        { account_pubkey: 'a', relay_url: 'wss://two.example/', forward_since: 200, backward_until: 0, pending_forward: null },
        { account_pubkey: 'b', relay_url: 'wss://one.example/', forward_since: 300, backward_until: 0, pending_forward: null },
      ]);
  } finally { sqlite.close(); }
});
