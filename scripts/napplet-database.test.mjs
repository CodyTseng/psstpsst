import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

test('account and artifact scopes survive recent removal and cascade only with their owner', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys=ON; CREATE TABLE accounts(pubkey TEXT PRIMARY KEY);');
    db.exec(readFileSync('src/db/migrations/0059_napplets.sql', 'utf8'));
    db.exec("INSERT INTO accounts VALUES ('A'), ('B');");
    const install = db.prepare(
      'INSERT INTO napplet_installations(account_pubkey,app_key,manifest,artifact_hash,last_used_at,pinned_at) VALUES(?,?,?,?,?,?)',
    );
    install.run('A', 'app', '{}', 'v1', 100, 10);
    install.run('B', 'app', '{}', 'v1', 200, null);
    const data = db.prepare(
      'INSERT INTO napplet_data(account_pubkey,app_key,artifact_hash,bucket,key,value,bytes) VALUES(?,?,?,?,?,?,?)',
    );
    data.run('A', 'app', 'v1', 'storage', 'key', 'A-old', 5);
    data.run('A', 'app', 'v2', 'storage', 'key', 'A-new', 5);
    data.run('B', 'app', 'v1', 'storage', 'key', 'B-only', 6);
    db.prepare(
      'UPDATE napplet_installations SET last_used_at=NULL,pinned_at=NULL WHERE account_pubkey=? AND app_key=?',
    ).run('A', 'app');
    assert.equal(
      db.prepare('SELECT COUNT(*) AS n FROM napplet_data WHERE account_pubkey=?').get('A').n,
      2,
    );
    assert.equal(
      db.prepare('SELECT last_used_at FROM napplet_installations WHERE account_pubkey=?').get('B')
        .last_used_at,
      200,
    );
    assert.equal(
      db
        .prepare('SELECT value FROM napplet_data WHERE account_pubkey=? AND artifact_hash=?')
        .get('A', 'v2').value,
      'A-new',
    );
    db.prepare('DELETE FROM accounts WHERE pubkey=?').run('A');
    assert.equal(
      db.prepare('SELECT COUNT(*) AS n FROM napplet_data WHERE account_pubkey=?').get('A').n,
      0,
    );
    assert.equal(
      db.prepare('SELECT value FROM napplet_data WHERE account_pubkey=?').get('B').value,
      'B-only',
    );
    assert.throws(() => data.run('A', 'app', 'v1', 'storage', 'late', 'late', 4));
  } finally {
    db.close();
  }
});
