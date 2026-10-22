import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

it('retires peer-bound crypto grants without changing operation-wide or event grants', () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec('CREATE TABLE signing_authorizations(id INTEGER PRIMARY KEY,operation TEXT,recipient TEXT,decision TEXT);');
    const insert = sqlite.prepare('INSERT INTO signing_authorizations(operation,recipient,decision) VALUES (?,?,?)');
    for (const operation of ['nip04-encrypt', 'nip04-decrypt', 'nip44-encrypt', 'nip44-decrypt'])
      for (const decision of ['allow', 'deny']) insert.run(operation, 'old-peer', decision);
    insert.run('nip44-decrypt', '', 'allow');
    insert.run('get-public-key', '', 'allow');
    insert.run('publish', 'event-recipient', 'deny');
    sqlite.exec(readFileSync(`${process.cwd()}/src/db/migrations/0073_crypto-operation-permissions.sql`, 'utf8'));
    expect(sqlite.prepare('SELECT operation,recipient,decision FROM signing_authorizations ORDER BY id').all()).toEqual([
      { operation: 'nip44-decrypt', recipient: '', decision: 'allow' },
      { operation: 'get-public-key', recipient: '', decision: 'allow' },
      { operation: 'publish', recipient: 'event-recipient', decision: 'deny' },
    ]);
  } finally { sqlite.close(); }
});
