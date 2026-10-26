import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

test('payment claims arbitrate concurrent requests and survive reopening and wallet removal', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'psst-webln-'));
  let sqlite = new DatabaseSync(path.join(directory, 'test.db'));
  try {
    sqlite.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE accounts(pubkey TEXT PRIMARY KEY);
      CREATE TABLE device_preferences(key TEXT PRIMARY KEY,value TEXT);
      CREATE TABLE wallets(id TEXT PRIMARY KEY, account_pubkey TEXT);
      INSERT INTO accounts VALUES('A'),('B'); INSERT INTO wallets VALUES('wallet','A');`);
    sqlite.exec(readFileSync('src/db/migrations/0075_webln-payments.sql', 'utf8'));
    const output = path.join(directory, 'claims.cjs');
    await build({ stdin: { contents: `
      export { createAsyncDatabase } from ${JSON.stringify(path.resolve('src/platform/create-async-database.ts'))};
      export * as schema from ${JSON.stringify(path.resolve('src/db/schema/index.ts'))};
      export function claims() { return require(${JSON.stringify(path.resolve('src/services/wallet/webln-payments.ts'))}); }
    `, loader: 'ts', resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'cjs', outfile: output,
      plugins: [{ name: 'test-database', setup(builder) {
        builder.onResolve({ filter: /^@\/db\/client$/ }, () => ({ path: 'db', namespace: 'fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const db = globalThis.__webLnDatabaseTest;' }));
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
    globalThis.__webLnDatabaseTest = fixture.createAsyncDatabase(executor, fixture.schema);
    const { claimWebLnPayment } = fixture.claims();
    const results = await Promise.allSettled([claimWebLnPayment('A', 'hash'), claimWebLnPayment('A', 'hash')]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.find(result => result.status === 'rejected').reason.message, 'payment-already-attempted');
    sqlite.exec('DELETE FROM wallets');
    sqlite.close(); sqlite = new DatabaseSync(path.join(directory, 'test.db')); sqlite.exec('PRAGMA foreign_keys=ON');
    await assert.rejects(claimWebLnPayment('A', 'hash'), /payment-already-attempted/);
    await claimWebLnPayment('B', 'hash');
    sqlite.exec("INSERT INTO device_preferences VALUES('account.removing.A','1')");
    await assert.rejects(claimWebLnPayment('A', 'another-hash'), /account-unavailable/);
    await assert.rejects(claimWebLnPayment('missing', 'hash'), /account-unavailable/);
    sqlite.exec("DELETE FROM accounts WHERE pubkey='A'");
    assert.deepEqual(sqlite.prepare('SELECT account_pubkey FROM webln_payments').all().map(row => row.account_pubkey), ['B']);
  } finally { delete globalThis.__webLnDatabaseTest; sqlite.close(); await rm(directory, { recursive: true, force: true }); }
});
