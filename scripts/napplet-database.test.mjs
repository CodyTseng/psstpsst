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

test('desktop migration and reordering preserve recent usage, data and account isolation', async () => {
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
    const { saveDesktopOrder, markRecent, clearRecent, getData, setData } = fixture.loadRepository();
    const insert = sqlite.prepare('INSERT INTO napplet_installations(account_pubkey,app_key,manifest,artifact_hash,last_used_at,pinned_at) VALUES(?,?,?,?,?,?)');
    insert.run('A', 'app', '{}', 'v1', 100, 10);
    insert.run('B', 'app', '{}', 'v1', 200, 20);
    insert.run('A', 'other-app', '{}', 'v1', 200, null);
    insert.run('A', 'unopened-app', '{}', 'v1', null, null);
    sqlite.exec(readFileSync('src/db/migrations/0060_napplet-desktop.sql', 'utf8'));
    sqlite.exec(readFileSync('src/db/migrations/0061_signing-authorizations.sql', 'utf8'));
    const order = (account = 'A') => sqlite.prepare('SELECT app_key FROM napplet_installations WHERE account_pubkey=? AND desktop_position IS NOT NULL ORDER BY desktop_position').all(account).map((row) => row.app_key);
    assert.deepEqual(order(), ['app', 'other-app'], 'legacy pin order migrates once');
    assert.deepEqual(order('B'), ['app']);
    const defaults = { accountPubkey: 'A', appKey: 'host:intent-defaults' };
    const otherAccount = { ...defaults, accountPubkey: 'B' };
    const storage = { accountPubkey: 'A', appKey: 'app' };
    await setData(defaults, 'defaults', 'napplet:image/edit', 'app');
    await setData(defaults, 'defaults', 'napplet:image/view', 'app');
    await setData(defaults, 'defaults', 'napplet:text/edit', 'other-app');
    await setData(otherAccount, 'defaults', 'napplet:image/edit', 'app');
    await setData(storage, 'storage', 'draft', 'keep me');
    await setData(storage, 'permissions', 'signing', 'keep grants');
    await markRecent('A', 'other-app');
    assert.deepEqual(order(), ['app', 'other-app'], 'launching never reorders the desktop');
    await saveDesktopOrder('A', ['other-app', 'app']);
    assert.deepEqual(order(), ['other-app', 'app']);
    assert.deepEqual(order('B'), ['app'], 'another account retains its own order');
    sqlite.exec("CREATE TRIGGER fail_position BEFORE UPDATE OF desktop_position ON napplet_installations WHEN NEW.app_key='other-app' BEGIN SELECT RAISE(ABORT,'position failed'); END;");
    await assert.rejects(saveDesktopOrder('A', ['app', 'other-app']));
    assert.deepEqual(order(), ['other-app', 'app'], 'a failed move rolls back all changed positions');
    sqlite.exec('DROP TRIGGER fail_position;');
    await saveDesktopOrder('A', ['other-app']);
    assert.deepEqual(order(), ['other-app']);
    assert.equal(sqlite.prepare("SELECT last_used_at FROM napplet_installations WHERE account_pubkey='A' AND app_key='app'").get().last_used_at, 100, 'removing a shortcut preserves its recent usage');
    assert.equal(await getData(defaults, 'defaults', 'napplet:image/edit'), 'app');
    assert.equal(await getData(otherAccount, 'defaults', 'napplet:image/edit'), 'app');
    assert.equal(await getData(storage, 'storage', 'draft'), 'keep me');
    assert.equal(await getData(storage, 'permissions', 'signing'), 'keep grants');
    await saveDesktopOrder('A', ['app', 'other-app', 'unopened-app']);
    assert.deepEqual(order(), ['app', 'other-app', 'unopened-app'], 'adding and re-adding create exactly one shortcut');
    await assert.rejects(saveDesktopOrder('A', ['app', 'app']));
    await assert.rejects(saveDesktopOrder('A', ['missing-app']));
    assert.deepEqual(order(), ['app', 'other-app', 'unopened-app']);
    await clearRecent('A', 'app');
    assert.equal(sqlite.prepare("SELECT last_used_at FROM napplet_installations WHERE account_pubkey='A' AND app_key='app'").get().last_used_at, null);
    assert.equal(sqlite.prepare("SELECT last_used_at FROM napplet_installations WHERE account_pubkey='B' AND app_key='app'").get().last_used_at, 200);
    assert.deepEqual(order(), ['app', 'other-app', 'unopened-app'], 'removing history preserves desktop order');
    assert.equal(await getData(storage, 'storage', 'draft'), 'keep me');
    assert.equal(await getData(storage, 'permissions', 'signing'), 'keep grants');
    await markRecent('A', 'app');
    assert(sqlite.prepare("SELECT last_used_at FROM napplet_installations WHERE account_pubkey='A' AND app_key='app'").get().last_used_at > 100,
      'opening restores an app to recent usage');
    sqlite.prepare("DELETE FROM accounts WHERE pubkey='A'").run();
    await assert.rejects(saveDesktopOrder('A', []));
    assert.deepEqual(order('B'), ['app']);
  } finally {
    delete globalThis.__nappletDatabaseTest;
    sqlite.close();
    await rm(directory, { recursive: true, force: true });
  }
});
