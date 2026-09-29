import Database from 'better-sqlite3';

import migrations from '../migrations/migrations';

describe('saved groups migration', () => {
  test('creates an account-scoped set of raw group ids', () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(migrations.migrations.m0051);

    const insert = sqlite.prepare(
      'INSERT INTO saved_groups (account_pubkey, group_id) VALUES (?, ?)',
    );
    insert.run('account-a', 'group-id');
    insert.run('account-b', 'group-id');

    expect(
      sqlite
        .prepare('SELECT account_pubkey, group_id FROM saved_groups ORDER BY account_pubkey')
        .all(),
    ).toEqual([
      { account_pubkey: 'account-a', group_id: 'group-id' },
      { account_pubkey: 'account-b', group_id: 'group-id' },
    ]);
    expect(() => insert.run('account-a', 'group-id')).toThrow();
    sqlite.close();
  });
});
