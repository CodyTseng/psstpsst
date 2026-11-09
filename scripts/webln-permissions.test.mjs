import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

test('wallet information rules survive reopening, expire, isolate sources and reset through shared management', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'psst-webln-permissions-'));
  const filename = path.join(directory, 'test.db');
  let sqlite = new DatabaseSync(filename);
  try {
    sqlite.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE accounts(pubkey TEXT PRIMARY KEY);
      CREATE TABLE device_preferences(key TEXT PRIMARY KEY,value TEXT);
      INSERT INTO accounts VALUES('A'),('B');`);
    sqlite.exec(readFileSync('src/db/migrations/0069_browser-authorizations.sql', 'utf8'));
    const preferences = readFileSync('src/db/migrations/0083_signing-levels.sql', 'utf8');
    sqlite.exec(preferences.slice(preferences.indexOf('CREATE TABLE signing_preferences')));
    sqlite.exec(readFileSync('src/db/migrations/0084_app-authorization.sql', 'utf8'));
    const output = path.join(directory, 'permissions.cjs');
    await build({ stdin: { contents: `
      export { createAsyncDatabase } from ${JSON.stringify(path.resolve('src/platform/create-async-database.ts'))};
      export * as schema from ${JSON.stringify(path.resolve('src/db/schema/index.ts'))};
      export function permissions() { return require(${JSON.stringify(path.resolve('src/services/explore/wallet-info-permission.ts'))}); }
      export function levels() { return require(${JSON.stringify(path.resolve('src/services/signing/repository.ts'))}); }
      export function management() { return require(${JSON.stringify(path.resolve('src/services/explore/browser-permission-store.ts'))}); }
    `, loader: 'ts', resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'cjs', outfile: output,
      plugins: [{ name: 'test-ports', setup(builder) {
        builder.onResolve({ filter: /^@\/db\/client$/ }, () => ({ path: 'database', namespace: 'fixture' }));
        builder.onResolve({ filter: /^@\/i18n\/core$/ }, () => ({ path: 'i18n', namespace: 'fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'database'
          ? 'export const db = globalThis.__walletInfoDatabaseTest;'
          : 'export default { t: key => key };' }));
      } }],
    });
    const { default: fixture } = await import(pathToFileURL(output).href);
    let tail = Promise.resolve();
    const executor = {
      async execute(sql, params, method) {
        const statement = sqlite.prepare(sql);
        if (method === 'run') { statement.run(...params); return { rows: [] }; }
        statement.setReturnArrays(true);
        return { rows: method === 'get' ? statement.get(...params) : statement.all(...params) };
      },
      transaction(task) {
        const work = tail.then(async () => {
          sqlite.exec('BEGIN');
          try { const result = await task(executor); sqlite.exec('COMMIT'); return result; }
          catch (error) { sqlite.exec('ROLLBACK'); throw error; }
        });
        tail = work.catch(() => {}); return work;
      },
    };
    globalThis.__walletInfoDatabaseTest = fixture.createAsyncDatabase(executor, fixture.schema);
    const { authorizeWalletInfo } = fixture.permissions();
    const management = fixture.management();
    const scope = { accountPubkey: 'A', sourceId: 'https://site.example' };
    const signal = new AbortController().signal;
    const levels = fixture.levels();
    await levels.saveAppAuthorizationLevel(scope, 'manual');
    let prompts = 0;
    const allowAlways = async () => { prompts++; return 'allow-always'; };
    const noPrompt = async () => { throw new Error('unexpected-prompt'); };
    (await authorizeWalletInfo(scope, 'Site', signal, allowAlways))();
    assert.equal(prompts, 1);
    sqlite.close(); sqlite = new DatabaseSync(filename); sqlite.exec('PRAGMA foreign_keys=ON');
    (await authorizeWalletInfo(scope, 'Site', signal, noPrompt))();
    assert.equal((await management.readBrowserPermissions(scope, 'webln-info'))[0].expiresAt, null);
    for (const other of [{ ...scope, accountPubkey: 'B' }, { ...scope, sourceId: 'https://other.example' }]) {
      await assert.rejects(authorizeWalletInfo(other, 'Other', signal, async () => false), /permission-denied/);
      assert.deepEqual(await management.readBrowserPermissions(other, 'webln-info'), []);
    }
    const newcomer = { ...scope, accountPubkey: 'B' };
    let selections = 0;
    (await authorizeWalletInfo(newcomer, 'Site', signal, async prompt => {
      assert.equal(prompt.appAuthorizationLevel, true);
      selections++; return 'routine';
    }))();
    assert.equal(selections, 1);
    assert.equal(await levels.readAppAuthorizationLevel(newcomer), 'routine');
    assert.deepEqual(await management.readBrowserPermissions(newcomer, 'webln-info'), []);
    (await authorizeWalletInfo(newcomer, 'Site', signal, noPrompt))();
    await management.saveBrowserPermissions(scope, ['webln-info'], 'deny', Date.now() + 3600000);
    await assert.rejects(authorizeWalletInfo(scope, 'Site', signal, noPrompt), /permission-denied/);
    for (const level of ['routine', 'trusted']) {
      await levels.saveAppAuthorizationLevel(scope, level);
      (await authorizeWalletInfo(scope, 'Site', signal, noPrompt))();
      assert.equal((await management.readBrowserPermissions(scope, 'webln-info'))[0].decision, 'deny');
    }
    await levels.saveAppAuthorizationLevel(scope, 'manual');
    await assert.rejects(authorizeWalletInfo(scope, 'Site', signal, noPrompt), /permission-denied/);
    sqlite.prepare("UPDATE browser_authorizations SET expires_at=1 WHERE resource='webln-info'").run();
    await assert.rejects(authorizeWalletInfo(scope, 'Site', signal, async () => { prompts++; return false; }), /permission-denied/);
    assert.equal(prompts, 2);
    await management.saveBrowserPermissions(scope, ['webln-info'], 'allow', null);
    await management.clearBrowserPermissions(scope, 'webln-info');
    await assert.rejects(authorizeWalletInfo(scope, 'Site', signal, async () => false), /permission-denied/);
    await management.saveBrowserPermissions(scope, ['webln-info'], 'allow', null);
    await management.clearBrowserPermissions(scope);
    assert.deepEqual(await management.readBrowserPermissions(scope), []);
    (await authorizeWalletInfo(scope, 'Site', signal, async () => 'allow'))();
    assert.deepEqual(await management.readBrowserPermissions(scope), [], 'one-time consent is not persisted');
    await management.saveBrowserPermissions(scope, ['webln-info'], 'allow', null);
    sqlite.prepare("DELETE FROM accounts WHERE pubkey='A'").run();
    assert.deepEqual(await management.readBrowserPermissions(scope), []);
    await assert.rejects(authorizeWalletInfo(scope, 'Site', signal, async () => 'manual'), /account-unavailable/);
  } finally { delete globalThis.__walletInfoDatabaseTest; sqlite.close(); await rm(directory, { recursive: true, force: true }); }
});
