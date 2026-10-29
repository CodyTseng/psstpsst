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

test('upgrades retain app data, operation-wide signer access, Favorites and account-scoped history', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'psst-signing-db-'));
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec('PRAGMA foreign_keys=ON; CREATE TABLE accounts(pubkey TEXT PRIMARY KEY); CREATE TABLE device_preferences(key TEXT PRIMARY KEY,value TEXT);');
    sqlite.exec("INSERT INTO accounts VALUES('A'),('B');");
    sqlite.exec('CREATE TABLE replaceable_events(pubkey TEXT,kind INTEGER,d_tag TEXT,event TEXT,created_at INTEGER,fetched_at INTEGER,PRIMARY KEY(pubkey,kind,d_tag));');
    sqlite.exec(readFileSync('src/db/migrations/0029_referenced_events.sql', 'utf8'));
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
      export { migrateApplicationFavorites } from ${JSON.stringify(path.resolve('src/db/data-migrations/application-favorites.ts'))};
      export { migrateEventKeys } from ${JSON.stringify(path.resolve('src/db/data-migrations/event-keys.ts'))};
      export { normalizeSigningSource,signingSourceFromLegacyKey } from ${JSON.stringify(path.resolve('src/services/signing/source.ts'))};
      export function repository() { return require(${JSON.stringify(path.resolve('src/services/signing/repository.ts'))}); }
      export function browserPermissions() { return require(${JSON.stringify(path.resolve('src/services/explore/browser-permission-store.ts'))}); }
      export function exploreRepository() { return require(${JSON.stringify(path.resolve('src/services/explore/repository.ts'))}); }
      export function appRepository() { return require(${JSON.stringify(path.resolve('src/services/napplet/repository.ts'))}); }
      export function permissions() { return require(${JSON.stringify(path.resolve('src/services/signing/permissions.ts'))}); }
    `, loader: 'ts', resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'cjs', outfile: output,
      plugins: [{ name: 'db', setup(builder) {
        // This storage fixture does not run deferred crypto/publication jobs.
        builder.onResolve({ filter: /\/favorites$/ }, () => ({ path: 'publication', namespace: 'private-sync' }));
        builder.onLoad({ filter: /.*/, namespace: 'private-sync' }, () => ({ contents: 'export function queueFavoritesPublication() {}' }));
        builder.onResolve({ filter: /configuration-publish\.service$/ }, () => ({ path: 'configuration', namespace: 'isolated-transport' }));
        builder.onResolve({ filter: /account-access$|account\.service$/ }, () => ({ path: 'signer', namespace: 'isolated-transport' }));
        builder.onResolve({ filter: /relay-pool$/ }, () => ({ path: 'relay', namespace: 'isolated-transport' }));
        builder.onResolve({ filter: /^@\/platform$/ }, () => ({ path: 'platform', namespace: 'isolated-transport' }));
        builder.onLoad({ filter: /.*/, namespace: 'isolated-transport' }, ({ path: module }) => ({ contents: {
          configuration: 'export async function canApplyConfigurationEvent() { return true; } export async function enqueueConfigurationEvent() { throw new Error("unexpected-publication"); }',
          signer: 'export async function buildSigner() { throw new Error("unexpected-signer"); }',
          relay: 'export const relayPool = {};',
          platform: 'export const platform = {};',
        }[module] }));
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
    sqlite.exec(readFileSync('src/db/migrations/0064_signer-access.sql','utf8'));
    sqlite.exec(readFileSync('src/db/migrations/0065_authorization-destinations.sql','utf8'));
    const beforeKindMigration = sqlite.prepare('SELECT * FROM signing_authorizations ORDER BY id').all();
    sqlite.exec('BEGIN');
    sqlite.exec(readFileSync('src/db/migrations/0066_signer-access-kind.sql','utf8'));
    sqlite.exec('COMMIT');
    assert.deepEqual(sqlite.prepare('SELECT * FROM signing_authorizations ORDER BY id').all(), beforeKindMigration,
      'the kind migration preserves every existing authorization field');
    sqlite.exec(readFileSync('src/db/migrations/0067_application-relay-auth.sql','utf8'));
    sqlite.exec(readFileSync('src/db/migrations/0068_signing-scope-key.sql','utf8'));
    sqlite.exec(readFileSync('src/db/migrations/0069_browser-authorizations.sql','utf8'));
    sqlite.exec(readFileSync('src/db/migrations/0056_private-list-sync-state.sql','utf8'));
    sqlite.exec(readFileSync('src/db/migrations/0070_private-favorites.sql','utf8'));
    assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
    const insertKind = sqlite.prepare(`INSERT INTO signing_authorizations
      (account_pubkey,source_id,operation,kind,decision,created_at,updated_at) VALUES('A','constraint-test',?,?,'allow',1,1)`);
    for (const kind of [-1, 65536]) assert.throws(() => insertKind.run('publish', kind), /CHECK constraint/);
    assert.throws(() => insertKind.run('get-public-key', 0), /CHECK constraint/);
    for (const kind of [0, 65535]) insertKind.run('publish', kind);
    assert.throws(() => insertKind.run('publish', 0), /UNIQUE constraint/);
    sqlite.prepare("DELETE FROM signing_authorizations WHERE source_id='constraint-test'").run();
    const legacySourceId = fixture.signingSourceFromLegacyKey(app);
    const sourceId = fixture.normalizeSigningSource(app);
    const scope = { accountPubkey: 'A', sourceId };
    assert.equal(sqlite.prepare('SELECT position FROM explore_shortcuts WHERE account_pubkey=? AND source_id=?').get('A',legacySourceId).position,2);
    assert.equal(sqlite.prepare('SELECT last_used_at FROM explore_history WHERE account_pubkey=? AND source_id=?').get('A',legacySourceId).last_used_at,123);
    sqlite.exec('BEGIN');
    sqlite.exec(readFileSync('src/db/migrations/0071_event-backed-applications.sql', 'utf8'));
    await fixture.migrateApplicationFavorites(globalThis.__signingDatabaseTest);
    sqlite.exec(readFileSync('src/db/migrations/0072_event-relay-sources.sql', 'utf8'));
    sqlite.exec(readFileSync('src/db/migrations/0073_crypto-operation-permissions.sql', 'utf8'));
    sqlite.exec(readFileSync('src/db/migrations/0076_local-applications.sql', 'utf8'));
    sqlite.exec(readFileSync('src/db/migrations/0077_event-keys.sql', 'utf8'));
    await fixture.migrateEventKeys(globalThis.__signingDatabaseTest);
    sqlite.exec('COMMIT');
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name IN ('explore_shortcuts','legacy_explore_shortcuts')").get().n, 0);
    const explore=fixture.exploreRepository();
    const website={key:'https://site.example/path',address:'https://site.example/path',title:'Website',kind:'website',description:'',servers:[],required:[],desktopPosition:null,lastUsedAt:null};
    await explore.visit('A',website);await explore.visit('B',website);
    await explore.reorder('A',[website.key],website);await explore.forget('A',website.key);
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
    assert.equal((await repository.readSigningSnapshot({ ...scope, sourceId: fixture.normalizeSigningSource(secondApp) })).rules[0].scope.kind, 7,
      'known legacy path manifests retain previous-version grants when the current version has none');
    assert.equal((await repository.readSigningSnapshot({ ...scope, sourceId: fixture.normalizeSigningSource(emptyApp) })).rules.length, 0,
      'a current-version reset never restores a previous grant');
    assert.equal(saved.rules.length, 1, 'narrow, malformed and expired legacy grants do not expand');
    assert.equal(saved.rules[0].scope.scopeKey, 'progress');
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
    const manyScope = { ...scope, sourceId: 'https://many-rules.example' };
    const manyRules = new SigningPermissions(manyScope, async () => 'allow-always', controller.signal, () => {});
    for (let index = 0; index < 80; index++) {
      await manyRules.authorize({ operation: 'publish', kind: 30078, relays: [],
        accountPubkey: scope.accountPubkey, content: '', createdAt: 1,
        tags: [['d', `record-${index}-${'x'.repeat(5000)}`]] });
    }
    const restoredRules = new SigningPermissions(manyScope, async () => { throw new Error('unexpected-prompt'); }, controller.signal, () => {});
    assert.equal((await restoredRules.snapshot()).rules.length, 80, 'all rules survive persistence beyond former count and byte quotas');
    for (const index of [0, 79]) await restoredRules.authorize({ operation: 'publish', kind: 30078, relays: [],
      accountPubkey: scope.accountPubkey, content: '', createdAt: 1,
      tags: [['d', `record-${index}-${'x'.repeat(5000)}`]] });

    let prompts = 0;
    const permissions = new SigningPermissions(scope, async () => { prompts++; return 'allow-always'; }, controller.signal, () => {});
    // Exercise the real repository: memory repositories cannot catch SQL CHECK failures.
    for (const operation of ['get-public-key', 'nip04-encrypt', 'nip04-decrypt', 'nip44-encrypt', 'nip44-decrypt']) {
      const before = prompts;
      await permissions.authorizeAccess(operation, controller.signal);
      const snapshot = await repository.readSigningSnapshot(scope);
      const accessRule = snapshot.rules.find(entry => entry.scope.operation === operation);
      assert.equal(accessRule.duration, 'always');
      assert.equal(accessRule.scope.kind, undefined);
      assert.deepEqual(accessRule.scope, { operation, relays: [] });
      assert.equal(sqlite.prepare('SELECT recipient FROM signing_authorizations WHERE account_pubkey=? AND source_id=? AND operation=?')
        .get(scope.accountPubkey, scope.sourceId, operation).recipient, '');
      const reloaded = new SigningPermissions(scope, async () => { throw new Error('unexpected-prompt'); }, controller.signal, () => {});
      await reloaded.authorizeAccess(operation);
      assert.equal(prompts, before + 1, 'durable access grants survive a new permission controller');
      await reloaded.edit(accessRule, { decision: 'deny', duration: 'always' });
      await assert.rejects(reloaded.authorizeAccess(operation), /permission-denied/);
      await reloaded.edit(accessRule, { decision: 'ask', duration: 'always' });
      assert(!(await repository.readSigningSnapshot(scope)).rules.some(entry => entry.scope.operation === operation));
      const expiresAt = Date.now() + 600000;
      await reloaded.edit(accessRule, { decision: 'allow', duration: 'timed', expiresAt });
      const timedRule = (await repository.readSigningSnapshot(scope)).rules.find(entry => entry.scope.operation === operation);
      assert.equal(timedRule.duration, 'timed');
      assert.equal(timedRule.expiresAt, expiresAt);
      const timed = new SigningPermissions(scope, async () => { throw new Error('unexpected-prompt'); }, controller.signal, () => {});
      await timed.authorizeAccess(operation);
      await timed.edit(accessRule, { decision: 'ask', duration: 'always' });

    }
    prompts = 0;
    const authRequest = { operation: 'relay-auth', kind: 22242, relays: ['wss://one.example/'], accountPubkey: 'A', content: '', tags: [], createdAt: 100 };
    await permissions.authorize(authRequest);
    const reloadedAuth = new SigningPermissions(scope, async () => { throw new Error('unexpected-auth-prompt'); }, controller.signal, () => {});
    await reloadedAuth.authorize({ ...authRequest, relays: ['wss://two.example/'] });
    const authRule = (await reloadedAuth.snapshot()).rules.find(entry => entry.scope.operation === 'relay-auth');
    assert.deepEqual(authRule.scope, { operation: 'relay-auth', kind: 22242, relays: [] });
    const authRow = sqlite.prepare("SELECT * FROM signing_authorizations WHERE source_id=? AND operation='relay-auth'").get(sourceId);
    assert.equal(authRow.destinations, '[]'); assert.equal(authRow.scope_key, '');
    await reloadedAuth.edit(authRule, { decision: 'deny', duration: 'always' });
    await assert.rejects(reloadedAuth.authorize({ ...authRequest, relays: ['wss://third.example/'] }), /permission-denied/);
    await reloadedAuth.edit(authRule, { decision: 'ask', duration: 'always' });
    const httpRequest = (url, method) => ({ operation: 'http-auth', kind: 27235, relays: [], accountPubkey: 'A',
      content: '', tags: [['u', url], ['method', method]], createdAt: 100 });
    let httpPrompts = 0;
    const httpPermissions = new SigningPermissions(scope, async () => { httpPrompts++; return 'allow-always'; }, controller.signal, () => {});
    await httpPermissions.authorize(httpRequest('https://one.example/', 'GET'));
    await httpPermissions.authorize(httpRequest('https://two.example/', 'POST'));
    assert.equal(httpPrompts, 1);
    const httpRule = (await repository.readSigningSnapshot(scope)).rules.find(rule => rule.scope.operation === 'http-auth');
    assert.deepEqual(httpRule.scope, { operation: 'http-auth', kind: 27235, relays: [] });
    const reloadedHttp = new SigningPermissions(scope, async () => { throw new Error('unexpected-http-prompt'); }, controller.signal, () => {});
    await reloadedHttp.authorize(httpRequest('https://third.example/', 'DELETE'));
    await reloadedHttp.edit(httpRule, { decision: 'deny', duration: 'always' });
    await assert.rejects(reloadedHttp.authorize(httpRequest('https://four.example/', 'PATCH')), /permission-denied/);
    const uploadRequest = { ...authRequest, operation: 'upload', kind: 24242, relays: ['https://media.example/'] };
    await permissions.authorize(uploadRequest);
    const uploadRule = (await repository.readSigningSnapshot(scope)).rules.find(rule => rule.scope.operation === 'upload');
    assert.deepEqual(uploadRule.scope, { operation: 'upload', kind: 24242, relays: [] });
    const reloadedUpload = new SigningPermissions(scope, async () => { throw new Error('unexpected-upload-prompt'); }, controller.signal, () => {});
    await reloadedUpload.authorize({ ...uploadRequest, relays: ['https://different.example/'] });
    for (const scopeKey of ['resource-one', 'resource-two']) {
      await permissions.authorize({ ...authRequest, operation: 'publish', kind: 12345, scopeKey, relays: [] });
    }
    const qualified = (await repository.readSigningSnapshot(scope)).rules.filter(entry => entry.scope.kind === 12345);
    assert.deepEqual(qualified.map(entry => entry.scope.scopeKey).sort(), ['resource-one', 'resource-two']);
    await repository.deleteSigningRule(scope, qualified[0].key);
    assert.equal((await repository.readSigningSnapshot(scope)).rules.filter(entry => entry.scope.kind === 12345).length, 1);
    prompts = 0;
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
    const browser = fixture.browserPermissions();
    await browser.saveBrowserPermissions(scope, ['audio', 'video'], 'allow', null);
    assert.deepEqual((await browser.readBrowserPermissions(scope)).map(row => row.resource).sort(), ['audio', 'video']);
    assert.deepEqual(await browser.readBrowserPermissions({ ...scope, accountPubkey: 'B' }), []);
    assert.deepEqual(await browser.readBrowserPermissions({ ...scope, sourceId: 'https://other.example' }), []);
    await browser.saveBrowserPermissions(scope, ['audio'], 'deny', Date.now() + 60000);
    assert.equal((await browser.readBrowserPermissions(scope)).find(row => row.resource === 'audio').decision, 'deny');
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM browser_authorizations').get().n, 2);
    sqlite.prepare("UPDATE browser_authorizations SET expires_at=1 WHERE resource='audio'").run();
    assert.deepEqual((await browser.readBrowserPermissions(scope)).map(row => row.resource), ['video']);
    await assert.rejects(browser.saveBrowserPermissions(scope, ['display-capture'], 'allow', null), /invalid-permissions/);
    await assert.rejects(browser.saveBrowserPermissions(scope, ['video'], 'allow', null, () => { throw new Error('closed'); }), /closed/);
    await browser.clearBrowserPermissions(scope, 'video');
    assert.deepEqual(await browser.readBrowserPermissions(scope), []);
    await browser.saveBrowserPermissions(scope, ['clipboard-read'], 'allow', null);
    controller.abort();
    sqlite.prepare('DELETE FROM accounts WHERE pubkey=?').run('A');
    for (const table of ['napplet_data', 'napplet_usage', 'napplet_data_legacy', 'signing_authorizations', 'signing_activity', 'browser_authorizations'])
      assert.equal(sqlite.prepare(`SELECT count(*) AS n FROM ${table} WHERE account_pubkey=?`).get('A').n, 0);
    assert.equal(sqlite.prepare('SELECT value FROM napplet_data WHERE account_pubkey=?').get('B').value, 'other-account');
    await assert.rejects(repository.saveSigningRule(scope, saved.rules[0]), /account-unavailable/);
  } finally {
    delete globalThis.__signingDatabaseTest;
    sqlite.close(); await rm(dir, { recursive: true, force: true });
  }
});


test('relay AUTH migration merges active decisions and generalizes d tags without changing other grants', () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec("PRAGMA foreign_keys=ON; CREATE TABLE accounts(pubkey TEXT PRIMARY KEY); INSERT INTO accounts VALUES('A'),('B');");
    const statements = readFileSync('src/db/migrations/0066_signer-access-kind.sql', 'utf8').split('--> statement-breakpoint');
    sqlite.exec(statements[0].replaceAll('signing_authorizations_new', 'signing_authorizations'));
    sqlite.exec(statements.at(-1));
    const insert = sqlite.prepare(`INSERT INTO signing_authorizations
      (account_pubkey,source_id,operation,kind,d_tag,destinations,decision,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`);
    const auth = (account, source, decision, updated, expiry = null, relay = 'wss://one.example/') =>
      insert.run(account, source, 'relay-auth', 22242, '', JSON.stringify([relay]), decision, expiry, updated - 1, updated);
    auth('A','one','allow',10); auth('A','one','deny',20,null,'wss://two.example/');
    auth('B','one','allow',30);
    auth('A','two','allow',40,Date.now()+600000); auth('A','two','deny',50,Date.now()-60000,'wss://two.example/');
    auth('A','tie','deny',60); auth('A','tie','allow',60,null,'wss://two.example/');
    insert.run('A','app','publish',30078,'CaseSensitive/记录','[]','allow',null,1,2);
    insert.run('A','app','upload',24242,'','["https://storage.example/"]','deny',null,3,4);
    const otherGrants = sqlite.prepare("SELECT * FROM signing_authorizations WHERE operation<>'relay-auth' ORDER BY id").all();
    sqlite.exec('BEGIN');
    sqlite.exec(readFileSync('src/db/migrations/0067_application-relay-auth.sql','utf8'));
    sqlite.exec(readFileSync('src/db/migrations/0068_signing-scope-key.sql','utf8'));
    sqlite.exec('COMMIT');
    assert.deepEqual(sqlite.prepare("SELECT account_pubkey,source_id,decision,destinations,scope_key FROM signing_authorizations WHERE operation='relay-auth' ORDER BY account_pubkey,source_id").all().map(row=>({...row})),[
      {account_pubkey:'A',source_id:'one',decision:'deny',destinations:'[]',scope_key:''},
      {account_pubkey:'A',source_id:'tie',decision:'deny',destinations:'[]',scope_key:''},
      {account_pubkey:'A',source_id:'two',decision:'allow',destinations:'[]',scope_key:''},
      {account_pubkey:'B',source_id:'one',decision:'allow',destinations:'[]',scope_key:''},
    ]);
    const others = sqlite.prepare("SELECT * FROM signing_authorizations WHERE operation<>'relay-auth' ORDER BY id").all();
    assert.deepEqual(others.map(({scope_key,...row})=>({...row,d_tag:scope_key})),otherGrants.map(row=>({...row})));
    assert(!sqlite.prepare('PRAGMA table_info(signing_authorizations)').all().some(column=>column.name==='d_tag'));
    const qualified = sqlite.prepare(`INSERT INTO signing_authorizations (account_pubkey,source_id,operation,kind,scope_key,decision,created_at,updated_at)
      VALUES('A','one','relay-auth',22242,?,'allow',1,1)`);
    assert.throws(()=>qualified.run(''), /UNIQUE constraint/);
    qualified.run('wss://future.example/');
    assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally { sqlite.close(); }
});
