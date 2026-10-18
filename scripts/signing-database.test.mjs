import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

test('upgrades retain app data, exact signing scopes, Explore shortcuts and account-scoped history', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'psst-signing-db-'));
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec('PRAGMA foreign_keys=ON; CREATE TABLE accounts(pubkey TEXT PRIMARY KEY); CREATE TABLE device_preferences(key TEXT PRIMARY KEY,value TEXT);');
    sqlite.exec("INSERT INTO accounts VALUES('A'),('B');");
    sqlite.exec(readFileSync('src/db/migrations/0059_napplets.sql', 'utf8'));
    sqlite.exec(readFileSync('src/db/migrations/0060_napplet-desktop.sql', 'utf8'));
    const app = `35129:${'b'.repeat(64)}:composer:notes`;
    const previous = JSON.stringify({ tags: [['x', 'v1']] });
    sqlite.prepare('INSERT INTO napplet_installations(account_pubkey,app_key,artifact_hash,manifest,previous_manifest) VALUES(?,?,?,?,?)').run('A', app, 'v2', '{}', previous);
    const add = (hash, bucket, key, value, account = 'A') => sqlite.prepare('INSERT INTO napplet_data VALUES(?,?,?,?,?,?,?)').run(account, app, hash, bucket, key, value, Buffer.byteLength(key + value));
    add('v1', 'storage', 'progress', 'old'); add('v2', 'storage', 'progress', 'current');
    add('v1', 'storage', 'only-old', 'retained'); add('v1', 'config', 'values', '{"theme":"dark"}');
    add('v0', 'storage', 'ambiguous', 'zero'); add('unknown', 'storage', 'ambiguous', 'other');
    add('v0', 'storage', 'unambiguous', 'same'); add('unknown', 'storage', 'unambiguous', 'same');
    add('v1', 'permissions', 'domains', '["shell","storage"]');
    add('v1', 'storage', 'progress', 'other-account', 'B');
    const legacyRule = (kind, identifier, extra = {}) => ({ scope: { operation: 'publish', kind, relays: [], identifier }, decision: 'allow', duration: 'always', createdAt: 100, ...extra });
    add('v2', 'permissions', 'signing', JSON.stringify({ version: 3, rules: [
      legacyRule(30078, 'progress'), legacyRule(30023, 'narrow', { scope: { operation: 'encrypt-publish', kind: 30023, identifier: 'narrow', recipient: 'peer' } }),
      legacyRule(24242, '', { scope: { operation: 'upload', kind: 24242, relays: ['https://media.example/'] } }),
      legacyRule(1, '', { duration: 'timed', expiresAt: 1 }), 'invalid rule',
    ] }));
    add('v2', 'permissions', 'signing-activity', JSON.stringify([{ scope: { operation: 'publish', kind: 30078 }, decision: 'allowed', at: 100 }]));
    add('v2', 'config', 'corrupt-backup', 'not json');
    const secondApp = `35129:${'b'.repeat(64)}:previous-only`;
    const emptyApp = `35129:${'b'.repeat(64)}:reset-current`;
    for (const appKey of [secondApp, emptyApp]) {
      sqlite.prepare('INSERT INTO napplet_installations(account_pubkey,app_key,artifact_hash,manifest,previous_manifest) VALUES(?,?,?,?,?)')
        .run('A', appKey, 'v2', '{}', JSON.stringify({ tags: [['x','aggregate','aggregate'],['path','/index.html','v1']] }));
      const value = JSON.stringify({ version: 3, rules: [legacyRule(7, '')] });
      sqlite.prepare('INSERT INTO napplet_data VALUES(?,?,?,?,?,?,?)').run('A',appKey,'v1','permissions','signing',value,Buffer.byteLength('signing'+value));
    }
    sqlite.prepare('INSERT INTO napplet_data VALUES(?,?,?,?,?,?,?)').run('A',emptyApp,'v2','permissions','signing','[]',9);
    const originalCount = sqlite.prepare('SELECT count(*) AS n FROM napplet_data').get().n;
    sqlite.prepare('UPDATE napplet_installations SET desktop_position=2,last_used_at=123 WHERE account_pubkey=? AND app_key=?').run('A',app);
    sqlite.exec('BEGIN');
    sqlite.exec(readFileSync('src/db/migrations/0061_signing-authorizations.sql', 'utf8'));
    const output = path.join(dir, 'fixture.cjs');
    await build({ stdin: { contents: `
      export { createAsyncDatabase } from ${JSON.stringify(path.resolve('src/platform/create-async-database.ts'))};
      export * as schema from ${JSON.stringify(path.resolve('src/db/schema/index.ts'))};
      export { migrateExplore } from ${JSON.stringify(path.resolve('src/db/data-migrations/explore.ts'))};
      export { migrateSigningSources } from ${JSON.stringify(path.resolve('src/db/data-migrations/signing-sources.ts'))};
      export { normalizeSigningSource,signingSourceFromLegacyKey } from ${JSON.stringify(path.resolve('src/services/signing/source.ts'))};
      export function repository() { return require(${JSON.stringify(path.resolve('src/services/signing/repository.ts'))}); }
      export function exploreRepository() { return require(${JSON.stringify(path.resolve('src/services/explore/repository.ts'))}); }
      export function appRepository() { return require(${JSON.stringify(path.resolve('src/services/napplet/repository.ts'))}); }
      export function permissions() { return require(${JSON.stringify(path.resolve('src/services/signing/permissions.ts'))}); }
    `, loader: 'ts', resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'cjs', outfile: output,
      plugins: [{ name: 'db', setup(builder) {
        builder.onResolve({ filter: /^@\/db\/client$/ }, () => ({ path: 'db', namespace: 'fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const db = globalThis.__signingDatabaseTest;' }));
      } }],
    });
    const { default: fixture } = await import(pathToFileURL(output).href);
    const executor = {
      async execute(query, params, method) {
        const statement = sqlite.prepare(query);
        if (method === 'run') { statement.run(...params); return { rows: [] }; }
        statement.setReturnArrays(true);
        return { rows: method === 'get' ? statement.get(...params) : statement.all(...params) };
      },
      async transaction(task) {
        sqlite.exec('BEGIN');
        try { const result = await task(executor); sqlite.exec('COMMIT'); return result; }
        catch (error) { sqlite.exec('ROLLBACK'); throw error; }
      },
    };
    globalThis.__signingDatabaseTest = fixture.createAsyncDatabase(executor, fixture.schema);
    await fixture.migrateSigningSources(globalThis.__signingDatabaseTest);
    sqlite.exec(readFileSync('src/db/migrations/0062_explore.sql','utf8'));
    await fixture.migrateExplore(globalThis.__signingDatabaseTest);
    sqlite.exec('COMMIT');
    const sourceId = fixture.signingSourceFromLegacyKey(app);
    const scope = { accountPubkey: 'A', sourceId };
    assert.equal(sqlite.prepare('SELECT position FROM explore_shortcuts WHERE account_pubkey=? AND source_id=?').get('A',sourceId).position,2);
    assert.equal(sqlite.prepare('SELECT last_used_at FROM explore_history WHERE account_pubkey=? AND source_id=?').get('A',sourceId).last_used_at,123);
    const explore=fixture.exploreRepository();
    const website={key:'https://site.example/path',address:'https://site.example/path',title:'Website',kind:'website',description:'',servers:[],required:[],desktopPosition:null,lastUsedAt:null};
    await explore.visit('A',website);await explore.visit('B',website);
    await explore.reorder('A',[website.key]);await explore.forget('A',website.key);
    assert.equal((await explore.readEntries('A')).find(e=>e.key===website.key).desktopPosition,0);
    assert.equal((await explore.readEntries('A')).find(e=>e.key===website.key).lastUsedAt,null);
    assert.notEqual((await explore.readEntries('B')).find(e=>e.key===website.key).lastUsedAt,null);

    const discovered={...website,key:'https://discovered.example/',address:'https://discovered.example/',title:'Discovered'};
    await explore.reorder('A',[website.key,discovered.key],discovered);
    const savedFavorite=(await explore.readEntries('A')).find(entry=>entry.key===discovered.key);
    assert.equal(savedFavorite.title,'Discovered','favorites persist their metadata without a visit');
    assert.equal(savedFavorite.desktopPosition,1);
    assert.equal(savedFavorite.lastUsedAt,null);
    assert.equal((await explore.readEntries('B')).some(entry=>entry.key===discovered.key),false);

    const read = (bucket, key) => sqlite.prepare('SELECT value FROM napplet_data WHERE account_pubkey=? AND app_key=? AND bucket=? AND key=?').get('A', app, bucket, key)?.value;
    assert.equal(read('storage', 'progress'), 'current');
    assert.equal(read('storage', 'only-old'), 'retained');
    assert.equal(read('config', 'values'), '{"theme":"dark"}');
    assert.equal(read('storage', 'ambiguous'), undefined, 'unknown-version conflicts never overwrite user data');
    assert.equal(read('storage', 'unambiguous'), 'same');
    assert.equal(read('permissions', 'domains'), '["shell","storage"]');
    assert.equal(read('permissions', 'signing'), undefined);
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM napplet_data_legacy').get().n, originalCount, 'all old records remain available as a backup');
    assert(!sqlite.prepare('PRAGMA table_info(napplet_data)').all().some((column) => column.name === 'artifact_hash'));
    assert(!sqlite.prepare('PRAGMA table_info(napplet_usage)').all().some((column) => column.name === 'artifact_hash'));
    const repository = fixture.repository();
    const saved = await repository.readSigningSnapshot(scope);
    assert.equal((await repository.readSigningSnapshot({ ...scope, sourceId: fixture.signingSourceFromLegacyKey(secondApp) })).rules[0].scope.kind, 7,
      'known legacy path manifests retain previous-version grants when the current version has none');
    assert.equal((await repository.readSigningSnapshot({ ...scope, sourceId: fixture.signingSourceFromLegacyKey(emptyApp) })).rules.length, 0,
      'a current-version reset never restores a previous grant');
    assert.equal(saved.rules.length, 1, 'narrow, malformed and expired legacy grants do not expand');
    assert.equal(saved.rules[0].scope.identifier, 'progress');
    assert.equal(saved.activity.length, 1);
    const appRepository = fixture.appRepository();
    const appScope = { accountPubkey: 'A', appKey: app };
    await appRepository.setData(appScope, 'storage', 'progress', 'after-upgrade');
    sqlite.prepare('UPDATE napplet_installations SET artifact_hash=? WHERE account_pubkey=? AND app_key=?').run('v3', 'A', app);
    assert.equal(await appRepository.getData(appScope, 'storage', 'progress'), 'after-upgrade');
    const usage = sqlite.prepare('SELECT bytes,count FROM napplet_usage WHERE account_pubkey=? AND app_key=? AND bucket=?').get('A', app, 'storage');
    const actual = sqlite.prepare('SELECT sum(bytes) AS bytes,count(*) AS count FROM napplet_data WHERE account_pubkey=? AND app_key=? AND bucket=?').get('A', app, 'storage');
    assert.deepEqual(usage, actual, 'quota counters are recomputed and updated atomically');
    const { SigningPermissions } = fixture.permissions();
    const controller = new AbortController();
    let prompts = 0;
    const permissions = new SigningPermissions(scope, async () => { prompts++; return 'allow-always'; }, controller.signal, () => {});
    const request = { operation: 'publish', kind: 1, relays: [], accountPubkey: 'A', content: 'private payload', tags: [], createdAt: 100 };
    await permissions.authorize(request);
    await permissions.authorize(request);
    assert.equal(prompts, 1);
    const rule = (await permissions.snapshot()).rules.find((entry) => entry.scope.kind === 1);
    await permissions.edit(rule, { decision: 'deny', duration: 'always' });
    await assert.rejects(permissions.authorize(request), /permission-denied/);
    await permissions.edit(rule, { decision: 'ask', duration: 'always' });
    assert(!(await repository.readSigningSnapshot(scope)).rules.some((entry) => entry.scope.kind === 1));
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM signing_authorizations WHERE source_id=? AND kind=1').get(sourceId).n, 0);
    for (let i = 0; i < 40; i++) await repository.recordSigningActivity(scope, { scope: { operation: 'publish', kind: i }, at: i, decision: 'allowed' });
    assert.equal((await repository.readSigningSnapshot(scope)).activity.length, 32);
    assert(!JSON.stringify(sqlite.prepare('SELECT * FROM signing_activity').all()).includes(request.content));
    assert.equal(fixture.normalizeSigningSource('https://EXAMPLE.com:8443/path'), 'https://example.com:8443');
    assert.equal(fixture.normalizeSigningSource('https://example.com:443/other?query=1'), 'https://example.com');
    assert.notEqual(fixture.normalizeSigningSource('http://example.com'), fixture.normalizeSigningSource('https://example.com'));
    assert.notEqual(fixture.normalizeSigningSource('https://example.com:8443'), fixture.normalizeSigningSource('https://example.com'));
    assert.notEqual(fixture.normalizeSigningSource('https://other.example.com'), fixture.normalizeSigningSource('https://example.com'));
    controller.abort();
    sqlite.prepare('DELETE FROM accounts WHERE pubkey=?').run('A');
    for (const table of ['napplet_data', 'napplet_usage', 'napplet_data_legacy', 'signing_authorizations', 'signing_activity'])
      assert.equal(sqlite.prepare(`SELECT count(*) AS n FROM ${table} WHERE account_pubkey=?`).get('A').n, 0);
    assert.equal(sqlite.prepare('SELECT value FROM napplet_data WHERE account_pubkey=?').get('B').value, 'other-account');
    await assert.rejects(repository.saveSigningRule(scope, saved.rules[0]), /account-unavailable/);
  } finally {
    delete globalThis.__signingDatabaseTest;
    sqlite.close(); await rm(dir, { recursive: true, force: true });
  }
});
