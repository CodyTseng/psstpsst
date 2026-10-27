import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { saveSigningRule } from '@/services/signing/repository';
import { signingRuleKey, type SigningRule } from '@/services/signing/model';
import { saveBrowserPermissions } from '../browser-permission-store';
import { signingRevision, subscribeSigning } from '@/services/signing/changes';
import { SigningPermissions } from '@/services/signing/permissions';
import { BrowserActions } from '../browser-actions';
import type { applicationTestDatabase } from '../testing/database';
import type { ExploreEntry } from '../model';
import { platform } from '@/platform';
import { randomId } from '@/services/napplet/protocol';

let mockDatabase: ReturnType<typeof applicationTestDatabase>;
let mockChanged: ((event: { tableName: string }) => void) | undefined;
jest.mock('@/db/client', () => ({ get db() { return mockDatabase.db; } }));
jest.mock('@/i18n/core', () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock('../favorites', () => ({ queueFavoritesPublication: jest.fn() }));
jest.mock('@/services/relay/private-list-sync.service', () => ({ readPrivateListState: async () => null, markPrivateListDirty: jest.fn() }));
jest.mock('../favorites-snapshot', () => ({ knownFavoriteSnapshot: () => [], readLocalFavoriteSnapshot: async () => [] }));
jest.mock('../application-cache', () => ({ ...jest.requireActual('../application-event'), readApplicationCache: async () => new Map(), cacheApplicationEvent: async () => {} }));
jest.mock('@/platform', () => ({ platform: {
  database: { addChangeListener: jest.fn(listener => { mockChanged = listener; return () => { mockChanged = undefined; }; }) },
  fileSystem: { documentDirectoryUri: async () => '/documents/', delete: jest.fn(async () => {}), stat: jest.fn(), listDirectory: jest.fn() },
  napplet: { clearPageData: jest.fn(async () => {}) },
  deviceCrypto: { sha256Hex: async (bytes: Uint8Array) => jest.requireActual('node:crypto').createHash('sha256').update(bytes).digest('hex') },
} }));
const api = () => jest.requireActual('../local-applications') as typeof import('../local-applications');
const entry = (version = 'a'.repeat(64)): ExploreEntry => ({ key: 'local~hello', address: 'local~hello', kind: 'napp', title: 'Local app',
  description: '', servers: [], required: ['network', 'ui'], desktopPosition: null, lastUsedAt: null,
  local: { version, installer: 'https://developer.example', actions: ['profile'] }, files: [{ path: '/index.html', mime: 'text/html', hash: 'b'.repeat(64) }] });
beforeEach(() => {
  mockDatabase = jest.requireActual('../testing/database').applicationTestDatabase(); mockChanged = undefined;
  for (const migration of ['0064_signer-access', '0065_authorization-destinations', '0066_signer-access-kind', '0067_application-relay-auth', '0068_signing-scope-key', '0069_browser-authorizations'])
    mockDatabase.sqlite.exec(readFileSync(`${process.cwd()}/src/db/migrations/${migration}.sql`, 'utf8'));
});
afterEach(() => mockDatabase.sqlite.close());

it('reaps only old abandoned transfers with the generated staging name', async () => {
  const root = await api().localApplicationDirectory('account');
  const old = `staging-${randomId()}`, fresh = `staging-${randomId()}`, unknownAge = `staging-${randomId()}`;
  const names = [old, fresh, unknownAge, 'a'.repeat(64), 'staging-invalid', `staging-${'b'.repeat(64)}`];
  jest.mocked(platform.fileSystem.delete).mockClear();
  jest.mocked(platform.fileSystem.listDirectory).mockResolvedValue(names.map(name => ({ name, uri: `${root}/${name}`, isDirectory: true })));
  jest.mocked(platform.fileSystem.stat).mockImplementation(async uri => ({ exists: true, isDirectory: true, size: null, creationTime: null,
    modificationTime: uri.endsWith(unknownAge) ? null : uri.endsWith(fresh) ? Date.now() : Date.now() - 25 * 60 * 60 * 1000 }));
  await api().reapLocalApplicationStorage('account');
  expect(platform.fileSystem.delete).toHaveBeenCalledTimes(1);
  expect(platform.fileSystem.delete).toHaveBeenCalledWith(`${root}/${old}`, { idempotent: true });
});

it('reaps obsolete versions while preserving the active version and fresh readers', async () => {
  const app = entry(), root = await api().localApplicationDirectory('account', app.key);
  const old = 'c'.repeat(64), fresh = 'd'.repeat(64);
  jest.mocked(platform.fileSystem.delete).mockClear();
  jest.mocked(platform.fileSystem.listDirectory).mockResolvedValue([app.local!.version, old, fresh].map(name => ({ name, uri: `${root}/${name}`, isDirectory: true })));
  jest.mocked(platform.fileSystem.stat).mockImplementation(async uri => ({ exists: true, isDirectory: true, size: null, creationTime: null,
    modificationTime: uri.endsWith(fresh) ? Date.now() : Date.now() - 25 * 60 * 60 * 1000 }));
  await api().reapLocalApplicationStorage('account', app);
  expect(platform.fileSystem.delete).toHaveBeenCalledTimes(1);
  expect(platform.fileSystem.delete).toHaveBeenCalledWith(`${root}/${old}`, { idempotent: true });
});

it('keeps unsigned apps and their file locations separate across accounts', async () => {
  const local = api();
  await local.commitLocalApplication('account', entry(), undefined, () => {});
  expect(await local.readLocalApplication('other', 'local~hello')).toBeUndefined();
  expect((await local.readLocalApplication('account', 'local~hello'))?.manifest).toBeUndefined();
  expect(mockDatabase.sqlite.prepare('SELECT value FROM napplet_data WHERE account_pubkey=? AND app_key=? AND bucket=? AND key=?')
    .get('account', 'local~hello', 'permissions', 'domains')).toMatchObject({ value: '["network","ui"]' });
  const a = await local.localApplicationDirectory('account', 'local~hello', entry().local!.version);
  const b = await local.localApplicationDirectory('other', 'local~hello', entry().local!.version);
  expect(a).not.toBe(b);
  expect(a).toContain(createHash('sha256').update('account').digest('hex'));
  await expect(local.localApplicationDirectory('account', 'local~../bad')).rejects.toThrow('invalid-local-application');
  await expect(local.loadLocalApplicationFile('account', entry(), '../private')).rejects.toThrow('local-file-unavailable');
});
it('rejects concurrent stale replacement and preserves committed metadata', async () => {
  const local = api(), initial = entry();
  await local.commitLocalApplication('account', initial, undefined, () => {});
  const newer = entry('c'.repeat(64));
  await local.commitLocalApplication('account', newer, initial.local!.version, () => {});
  await expect(local.commitLocalApplication('account', entry('d'.repeat(64)), initial.local!.version, () => {})).rejects.toThrow('installation-changed');
  expect((await local.readLocalApplication('account', initial.key))?.local?.version).toBe(newer.local!.version);
});
it('rolls back a write if cancellation arrives after insertion', async () => {
  let checks = 0;
  await expect(api().commitLocalApplication('account', entry(), undefined, () => { if (++checks === 3) throw new Error('closed'); })).rejects.toThrow('closed');
  expect(await api().readLocalApplication('account', 'local~hello')).toBeUndefined();
  expect(mockDatabase.sqlite.prepare('SELECT count(*) AS n FROM napplet_data').get()).toMatchObject({ n: 0 });
});
it('rejects removal-in-progress accounts and cascades local metadata on account deletion', async () => {
  const local = api();
  mockDatabase.sqlite.prepare('INSERT INTO device_preferences VALUES (?,?)').run('account.removing.account', '1');
  await expect(local.commitLocalApplication('account', entry(), undefined, () => {})).rejects.toThrow('account-unavailable');
  await local.commitLocalApplication('other', entry(), undefined, () => {});
  mockDatabase.sqlite.prepare('DELETE FROM accounts WHERE pubkey=?').run('other');
  expect(await local.readLocalApplication('other', 'local~hello')).toBeUndefined();
});
it('invalidates old app documents on version changes and removes the watcher', async () => {
  const local = api(), old = entry();
  await local.commitLocalApplication('account', old, undefined, () => {});
  const changed = jest.fn(), stop = local.watchLocalApplication('account', old, changed);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(changed).not.toHaveBeenCalled();
  await local.commitLocalApplication('account', entry('c'.repeat(64)), old.local!.version, () => {});
  mockChanged?.({ tableName: 'local_applications' });
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(changed).toHaveBeenCalledTimes(1);
  expect(changed.mock.calls[0][0].local.version).toBe('c'.repeat(64));
  expect(mockChanged).toBeUndefined(); stop();
});

it('keeps local desktop membership out of signed favorites and reopens lightweight history references', async () => {
  const app = entry(), local = api();
  await local.commitLocalApplication('account', app, undefined, () => {});
  const repository = jest.requireActual('../repository') as typeof import('../repository');
  await repository.reorder('account', [app.key], app);
  const favorites = await repository.readFavoriteReferences('account');
  expect(favorites).toHaveLength(1);
  expect(favorites[0]).toMatchObject({ key: app.key, desktopPosition: 0, local: app.local });
  expect(favorites[0].files).toBeUndefined();
  expect(mockDatabase.sqlite.prepare('SELECT count(*) AS n FROM private_list_sync_state').get()).toMatchObject({ n: 0 });
  await repository.visit('account', app);
  const history = await repository.readHistoryPage('account');
  expect(history.entries[0]).toMatchObject({ key: app.key, title: 'Local app', local: app.local });
  expect(history.entries[0].files).toBeUndefined();
  expect((await local.readLocalApplication('account', app.key))?.files).toHaveLength(1);
  await repository.reorder('account', []);
  expect(await repository.readFavoriteReferences('account')).toEqual([]);
});

const grant: SigningRule = { key: signingRuleKey({ operation: 'publish', kind: 1, relays: [] }),
  scope: { operation: 'publish', kind: 1, relays: [] }, decision: 'allow', duration: 'always', createdAt: 1 };
const authorizationCounts = (account = 'account') => ['signing_authorizations', 'browser_authorizations'].map(table =>
  (mockDatabase.sqlite.prepare(`SELECT count(*) AS n FROM ${table} WHERE account_pubkey=? AND source_id=?`).get(account, 'local~hello') as { n: number }).n);

it.each(['Renamed installation', ''])('reads current local history metadata after replacing the title with %j without revisiting', async title => {
  const local = api(), original = entry();
  const repository = jest.requireActual('../repository') as typeof import('../repository');
  await local.commitLocalApplication('account', original, undefined, () => {});
  await repository.visit('account', original);
  const before = await repository.readHistoryPage('account');
  const replacement = { ...entry('c'.repeat(64)), title, description: 'Updated description' };
  await local.commitLocalApplication('account', replacement, original.local!.version, () => {});
  const after = await repository.readHistoryPage('account');
  expect(after.entries).toHaveLength(1);
  expect(after.entries[0]).toMatchObject({ title: title || original.title, description: replacement.description,
    local: replacement.local, lastUsedAt: before.entries[0].lastUsedAt, desktopPosition: null });
  expect(after.entries[0].files).toBeUndefined();
  expect(after.cursor).toEqual(before.cursor);
  expect(mockDatabase.sqlite.prepare('SELECT title FROM explore_entries WHERE account_pubkey=? AND source_id=?')
    .get('account', original.key)).toMatchObject({ title: original.title });
});

it('clears decisions written during staging atomically before releasing old documents', async () => {
  const local = api(), old = entry(), next = entry('c'.repeat(64));
  await local.commitLocalApplication('account', old, undefined, () => {});
  await local.commitLocalApplication('other', old, undefined, () => {});
  const scope = { accountPubkey: 'account', sourceId: old.key, localVersion: old.local!.version };
  await saveSigningRule(scope, grant);
  await saveBrowserPermissions(scope, ['video'], 'allow', null);
  await saveBrowserPermissions({ ...scope, accountPubkey: 'other' }, ['video'], 'allow', null);
  expect(authorizationCounts()).toEqual([1, 1]);
  const released = jest.fn(() => { expect(authorizationCounts()).toEqual([0, 0]); });
  const stop = local.watchLocalApplication('account', old, released);
  await local.commitLocalApplication('account', next, old.local!.version, () => {});
  expect(released).toHaveBeenCalledTimes(1);
  expect(authorizationCounts()).toEqual([0, 0]);
  expect(authorizationCounts('other')).toEqual([0, 1]);
  // This models another host whose old document has not received its DB notification yet.
  await expect(saveSigningRule(scope, grant)).rejects.toThrow('permission-revoked');
  await expect(saveBrowserPermissions(scope, ['video'], 'allow', null)).rejects.toThrow('permission-revoked');
  expect(authorizationCounts()).toEqual([0, 0]);
  const current = { ...scope, localVersion: next.local!.version };
  await saveSigningRule(current, grant);
  await saveBrowserPermissions(current, ['video'], 'allow', null);
  expect(authorizationCounts()).toEqual([1, 1]); stop();
});

it('preserves decisions and active documents on a stale or rolled-back transition', async () => {
  const local = api(), old = entry(), next = entry('c'.repeat(64));
  await local.commitLocalApplication('account', old, undefined, () => {});
  const scope = { accountPubkey: 'account', sourceId: old.key, localVersion: old.local!.version };
  const detach = subscribeSigning(scope, () => {});
  await saveSigningRule(scope, grant); await saveBrowserPermissions(scope, ['video'], 'allow', null);
  const revision = signingRevision(scope), released = jest.fn(), stop = local.watchLocalApplication('account', old, released);
  await expect(local.commitLocalApplication('account', next, 'wrong-version', () => {})).rejects.toThrow('installation-changed');
  let checks = 0;
  await expect(local.commitLocalApplication('account', next, old.local!.version, () => { if (++checks === 3) throw new Error('closed'); })).rejects.toThrow('closed');
  expect(authorizationCounts()).toEqual([1, 1]);
  expect((await local.readLocalApplication('account', old.key))?.local?.version).toBe(old.local!.version);
  expect(signingRevision(scope)).toBe(revision); expect(released).not.toHaveBeenCalled(); stop(); detach();
});

it('rejects old in-memory approvals before a sibling host receives document invalidation', async () => {
  const local = api(), old = entry(), next = entry('c'.repeat(64));
  await local.commitLocalApplication('account', old, undefined, () => {});
  const scope = { accountPubkey: 'account', sourceId: old.key, localVersion: old.local!.version }, life = new AbortController();
  const signingReview = jest.fn(async () => 'allow-session'), browserReview = jest.fn(async () => 'allow');
  const signer = new SigningPermissions(scope, signingReview, life.signal, () => {});
  const browser = new BrowserActions({ account: 'account', sourceId: old.key, localVersion: old.local!.version, signal: life.signal,
    application: { title: old.title, description: '', servers: [], required: [] }, confirm: browserReview, open: async () => {} });
  try {
    await signer.authorizeAccess('get-public-key');
    await expect(browser.authorize({ action: 'permission', resources: ['video'] })).resolves.toMatchObject({ allowed: true });
    await local.commitLocalApplication('account', next, old.local!.version, () => {});
    expect(life.signal.aborted).toBe(false);
    await expect(signer.authorizeAccess('get-public-key')).rejects.toThrow('permission-revoked');
    await expect(browser.authorize({ action: 'permission', resources: ['video'] })).rejects.toThrow('permission-revoked');
    expect(signingReview).toHaveBeenCalledTimes(1); expect(browserReview).toHaveBeenCalledTimes(1);
  } finally { life.abort(); }
});
