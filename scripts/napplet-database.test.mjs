import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

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

test('removing an app atomically clears only its account-owned default handlers and adjusts usage', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'psst-napplet-repository-'));
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec('PRAGMA foreign_keys=ON; CREATE TABLE accounts(pubkey TEXT PRIMARY KEY); CREATE TABLE device_preferences(key TEXT PRIMARY KEY,value TEXT);');
    sqlite.exec(readFileSync('src/db/migrations/0059_napplets.sql', 'utf8'));
    sqlite.exec("INSERT INTO accounts VALUES ('A'), ('B');");
    const output = path.join(directory, 'fixture.cjs');
    await build({
      stdin: { contents: `
        export { createAsyncDatabase } from ${JSON.stringify(path.resolve('src/platform/create-async-database.ts'))};
        export * as schema from ${JSON.stringify(path.resolve('src/db/schema/index.ts'))};
        export function loadRepository() { return require(${JSON.stringify(path.resolve('src/services/napplet/repository.ts'))}); }
      `, resolveDir: process.cwd(), loader: 'ts' },
      bundle: true, platform: 'node', format: 'cjs', outfile: output,
      plugins: [{ name: 'isolated-database', setup(builder) {
        builder.onResolve({ filter: /^@\/db\/client$/ }, () => ({ path: 'database', namespace: 'fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const db = globalThis.__nappletDatabaseTest;' }));
      } }],
    });
    const { default: fixture } = await import(pathToFileURL(output).href);
    const executor = {
      async execute(sql, params, method) {
        const statement = sqlite.prepare(sql);
        if (method === 'run') { statement.run(...params); return { rows: [] }; }
        statement.setReturnArrays(true);
        return { rows: method === 'get' ? statement.get(...params) : statement.all(...params) };
      },
      async transaction(task) {
        sqlite.exec('BEGIN');
        try { const value = await task(executor); sqlite.exec('COMMIT'); return value; }
        catch (error) { sqlite.exec('ROLLBACK'); throw error; }
      },
    };
    globalThis.__nappletDatabaseTest = fixture.createAsyncDatabase(executor, fixture.schema);
    const { changeRecent, getData, setData } = fixture.loadRepository();
    const insert = sqlite.prepare('INSERT INTO napplet_installations(account_pubkey,app_key,manifest,artifact_hash,last_used_at,pinned_at) VALUES(?,?,?,?,?,?)');
    insert.run('A', 'app', '{}', 'v1', 100, 10);
    insert.run('B', 'app', '{}', 'v1', 200, 20);
    const defaults = { accountPubkey: 'A', appKey: 'host:intent-defaults', artifactHash: 'host' };
    const otherAccount = { ...defaults, accountPubkey: 'B' };
    const storage = { accountPubkey: 'A', appKey: 'app', artifactHash: 'v1' };
    await setData(defaults, 'defaults', 'napplet:image/edit', 'app');
    await setData(defaults, 'defaults', 'napplet:image/view', 'app');
    await setData(defaults, 'defaults', 'napplet:text/edit', 'other-app');
    await setData(otherAccount, 'defaults', 'napplet:image/edit', 'app');
    await setData(storage, 'storage', 'draft', 'keep me');
    await setData(storage, 'permissions', 'signing', 'keep grants');
    await changeRecent('A', 'app', 'pin');
    await changeRecent('A', 'app', 'unpin');
    assert.equal(await getData(defaults, 'defaults', 'napplet:image/edit'), 'app', 'pin changes do not affect defaults');
    sqlite.prepare('UPDATE napplet_installations SET pinned_at=10 WHERE account_pubkey=?').run('A');
    sqlite.exec("CREATE TRIGGER fail_default_cleanup BEFORE DELETE ON napplet_data WHEN OLD.app_key='host:intent-defaults' BEGIN SELECT RAISE(ABORT,'cleanup failed'); END;");
    await assert.rejects(changeRecent('A', 'app', 'remove'), (error) => error.cause?.message === 'cleanup failed');
    assert.equal(sqlite.prepare('SELECT last_used_at FROM napplet_installations WHERE account_pubkey=?').get('A').last_used_at, 100, 'failed cleanup rolls back removal');
    assert.equal(await getData(defaults, 'defaults', 'napplet:image/edit'), 'app');
    sqlite.exec('DROP TRIGGER fail_default_cleanup;');
    await changeRecent('A', 'app', 'remove');
    assert.equal(await getData(defaults, 'defaults', 'napplet:image/edit'), null);
    assert.equal(await getData(defaults, 'defaults', 'napplet:image/view'), null);
    assert.equal(await getData(defaults, 'defaults', 'napplet:text/edit'), 'other-app');
    assert.equal(await getData(otherAccount, 'defaults', 'napplet:image/edit'), 'app');
    assert.equal(await getData(storage, 'storage', 'draft'), 'keep me');
    assert.equal(await getData(storage, 'permissions', 'signing'), 'keep grants');
    const usage = sqlite.prepare("SELECT bytes,count FROM napplet_usage WHERE account_pubkey='A' AND app_key='host:intent-defaults' AND artifact_hash='host' AND bucket='defaults'").get();
    assert.equal(usage.count, 1);
    assert.equal(usage.bytes, new TextEncoder().encode('napplet:text/editother-app').length);
    assert.equal(sqlite.prepare('SELECT pinned_at FROM napplet_installations WHERE account_pubkey=?').get('A').pinned_at, null);
    assert.equal(sqlite.prepare('SELECT last_used_at FROM napplet_installations WHERE account_pubkey=?').get('B').last_used_at, 200);
    await changeRecent('A', 'app', 'remove');
    assert.equal(sqlite.prepare("SELECT count FROM napplet_usage WHERE account_pubkey='A' AND app_key='host:intent-defaults'").get().count, 1, 'repeated removal leaves counters intact');
  } finally {
    delete globalThis.__nappletDatabaseTest;
    sqlite.close();
    await rm(directory, { recursive: true, force: true });
  }
});
