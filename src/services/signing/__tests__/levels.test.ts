import type { AppAuthorizationLevel } from '@/services/app-authorization/model';
import { SigningPermissions, signingRuleKey, type SigningRequest } from '../permissions';
import { automaticallyAllowsSigning, automaticallyAllowsAccess, automaticallyAllowsWalletInfo } from '@/services/app-authorization/policy';
import { memoryRepository, levels, rules, activity } from '../testing/memory-repository';
import { saveAppAuthorizationLevel } from '../repository';
import { ApplicationSigner } from '../application-signer';
import type { Signer } from '@/services/signer/signer.interface';
import { ensureAppAuthorizationLevel } from '@/services/app-authorization/level';
import { resolveDomainPermissions } from '@/services/napplet/domain-permissions';

jest.mock('@/services/napplet/repository', () => ({ getData: jest.fn(async () => null) }));
jest.mock('../repository', () => jest.requireActual('../testing/memory-repository').memoryRepository);
const scope = { accountPubkey: 'account', sourceId: 'https://app.example' };
const scopeId = JSON.stringify(scope);
const request: SigningRequest = { operation: 'sign', kind: 1, accountPubkey: 'account', relays: [],
  content: 'hello', tags: [], createdAt: 100 };
const controllers: AbortController[] = [];
function create(choose = jest.fn(async (): Promise<string | false> => 'routine'),
  confirm = jest.fn(async (): Promise<string | false> => 'allow')) {
  const life = new AbortController(); controllers.push(life);
  return { permissions: new SigningPermissions(scope, confirm, life.signal, () => {}, choose), choose, confirm, life };
}
beforeEach(() => {
  jest.clearAllMocks(); levels.clear(); rules.clear(); activity.clear();
  levels.set(scopeId, undefined);
});
afterEach(() => controllers.splice(0).forEach(life => life.abort()));

test.each(['manual', 'routine', 'trusted'] as const)('first request explicitly saves %s before applying its policy', async level => {
  const value = create(jest.fn(async () => level));
  await value.permissions.authorize(request);
  expect(value.choose).toHaveBeenCalledTimes(1);
  expect(value.confirm).toHaveBeenCalledTimes(level === 'manual' ? 1 : 0);
  expect(levels.get(scopeId)).toBe(level);
  const next = create();
  await next.permissions.authorize(request);
  expect(next.choose).not.toHaveBeenCalled();
  expect(rules.get(scopeId) ?? []).toEqual([]);
});

test.each([false, 'allow-always', 'invalid'] as const)('closing or returning %s never saves authority', async answer => {
  const value = create(jest.fn(async () => answer));
  await expect(value.permissions.authorize(request)).rejects.toThrow('permission-denied');
  expect(levels.get(scopeId)).toBeUndefined();
  expect(value.confirm).not.toHaveBeenCalled();
  expect(activity.get(scopeId)).toBeUndefined();
});

test('queued controllers choose once and recheck the saved level', async () => {
  const first = create(); const second = create();
  await Promise.all([first.permissions.authorize(request), second.permissions.authorize(request)]);
  expect(first.choose).toHaveBeenCalledTimes(1);
  expect(second.choose).not.toHaveBeenCalled();
  expect(first.confirm).not.toHaveBeenCalled();
  expect(second.confirm).not.toHaveBeenCalled();
});

test('sensitive first request asks separately after Routine selection', async () => {
  const value = create();
  await value.permissions.authorize({ ...request, kind: 5 });
  expect(value.choose.mock.invocationCallOrder[0]).toBeLessThan(value.confirm.mock.invocationCallOrder[0]);
  expect(value.confirm).toHaveBeenCalledTimes(1);
});

test('failed level persistence does not return account authority', async () => {
  const value = create();
  memoryRepository.saveAppAuthorizationLevel.mockRejectedValueOnce(new Error('disk-full'));
  await expect(value.permissions.authorize(request)).rejects.toThrow('disk-full');
  expect(levels.get(scopeId)).toBeUndefined();
  expect(value.confirm).not.toHaveBeenCalled();
});

test('account, source and invalid requests cannot reuse or install another level', async () => {
  const value = create();
  await expect(value.permissions.authorize({ ...request, accountPubkey: 'other' })).rejects.toThrow('account-unavailable');
  await expect(value.permissions.authorize({ ...request, kind: 65536 })).rejects.toThrow('invalid-signing-request');
  expect(value.choose).not.toHaveBeenCalled();
  await value.permissions.authorize(request);
  const life = new AbortController(); controllers.push(life);
  const choose = jest.fn(async () => 'manual');
  levels.set(JSON.stringify({ ...scope, sourceId: 'https://other.example' }), undefined);
  const other = new SigningPermissions({ ...scope, sourceId: 'https://other.example' }, jest.fn(async () => 'allow'), life.signal, () => {}, choose);
  await other.authorize(request);
  expect(choose).toHaveBeenCalledTimes(1);
});

test.each(['deny', 'ask'] as const)('levels ignore a saved %s while covered and restore it after downgrade', async decision => {
  levels.set(scopeId, 'manual');
  const value = create();
  const target = { key: signingRuleKey(request), scope: request };
  await value.permissions.edit(target, { decision, duration: 'always' });
  for (const level of ['routine', 'trusted'] as const) {
    await saveAppAuthorizationLevel(scope, level);
    await value.permissions.authorize(request);
    expect(value.confirm).not.toHaveBeenCalled();
    expect((await value.permissions.snapshot()).rules[0].decision).toBe(decision);
  }
  await saveAppAuthorizationLevel(scope, 'manual');
  if (decision === 'deny') await expect(value.permissions.authorize(request)).rejects.toThrow('permission-denied');
  else {
    await value.permissions.authorize(request);
    expect(value.confirm).toHaveBeenCalledTimes(1);
  }
});

test('uncovered operations still use their individual allow, deny and Ask decisions', async () => {
  levels.set(scopeId, 'routine');
  const value = create();
  const sensitive = { ...request, kind: 5 };
  const target = { key: signingRuleKey(sensitive), scope: sensitive };
  await value.permissions.edit(target, { decision: 'allow', duration: 'always' });
  await value.permissions.authorize(sensitive);
  expect(value.confirm).not.toHaveBeenCalled();
  await value.permissions.edit(target, { decision: 'deny', duration: 'always' });
  await expect(value.permissions.authorize(sensitive)).rejects.toThrow('permission-denied');
  await value.permissions.edit(target, { decision: 'ask', duration: 'always' });
  await value.permissions.authorize(sensitive);
  expect(value.confirm).toHaveBeenCalledTimes(1);
});

test('session consent overrides persisted Ask after level and unrelated-rule reloads', async () => {
  levels.set(scopeId, 'manual');
  const value = create(jest.fn(async () => 'manual'), jest.fn(async () => 'allow-session'));
  const sensitive = { ...request, kind: 5 };
  const target = { key: signingRuleKey(sensitive), scope: sensitive };
  await value.permissions.edit(target, { decision: 'ask', duration: 'always' });
  await value.permissions.authorize(sensitive);
  expect(value.confirm).toHaveBeenCalledTimes(1);
  await saveAppAuthorizationLevel(scope, 'routine');
  await value.permissions.authorize(sensitive);
  const unrelated = { ...request, kind: 0 };
  await value.permissions.edit({ key: signingRuleKey(unrelated), scope: unrelated }, { decision: 'deny', duration: 'always' });
  await value.permissions.authorize(sensitive);
  expect(value.confirm).toHaveBeenCalledTimes(1);
  const matching = (await value.permissions.snapshot()).rules.filter(rule => rule.key === target.key);
  expect(matching).toHaveLength(1);
  expect(matching[0]).toMatchObject({ decision: 'allow', duration: 'session' });
  expect(rules.get(scopeId)?.find(rule => rule.key === target.key)?.decision).toBe('ask');
  const reopened = create();
  await reopened.permissions.authorize(sensitive);
  expect(reopened.confirm).toHaveBeenCalledTimes(1);
});

test('expiry falls back to level policy rather than creating a permanent grant', async () => {
  levels.set(scopeId, 'routine');
  const target = { key: signingRuleKey(request), scope: request };
  rules.set(scopeId, [{ ...target, duration: 'timed', decision: 'deny', expiresAt: Date.now() - 1, createdAt: 1 }]);
  const value = create();
  await value.permissions.authorize(request);
  expect(value.confirm).not.toHaveBeenCalled();
});

test('changing policy while a level chooser is visible rejects its stale answer', async () => {
  let resolve!: (value: string) => void;
  const value = create(jest.fn(() => new Promise<string>(done => { resolve = done; })));
  const pending = value.permissions.authorize(request);
  while (!resolve) await new Promise(done => setTimeout(done, 0));
  await saveAppAuthorizationLevel(scope, 'manual');
  resolve('trusted');
  await expect(pending).rejects.toThrow('permission-denied');
  expect(levels.get(scopeId)).toBe('manual');
});

test('reset removes the level and aborting a chooser cannot persist its answer', async () => {
  const value = create();
  await value.permissions.authorize(request);
  await memoryRepository.clearSigningPermissions(scope);
  await value.permissions.authorize(request);
  expect(value.choose).toHaveBeenCalledTimes(2);
  await memoryRepository.clearSigningPermissions(scope);
  let resolve!: (value: string) => void;
  const cancelled = create(jest.fn(() => new Promise<string>(done => { resolve = done; })));
  const pending = cancelled.permissions.authorize(request);
  const rejected = expect(pending).rejects.toThrow();
  while (!resolve) await new Promise(done => setTimeout(done, 0));
  cancelled.life.abort(); resolve('trusted');
  await rejected;
  expect(levels.get(scopeId)).toBeUndefined();
});

test('a level downgrade withholds a signature already running under Trusted', async () => {
  levels.set(scopeId, 'trusted');
  const value = create();
  let resolve!: (event: unknown) => void;
  const signer = { signEvent: jest.fn(() => new Promise(done => { resolve = done; })) } as unknown as Signer;
  const application = new ApplicationSigner({ permissions: value.permissions, accountPubkey: 'account', signer: async () => signer, current: () => {} });
  const pending = application.signEvent({ kind: 1, content: '', tags: [], created_at: 100 }, template => signer.signEvent(template));
  while (!resolve) await new Promise(done => setTimeout(done, 0));
  await saveAppAuthorizationLevel(scope, 'manual');
  resolve({ id: 'signed' });
  await expect(pending).rejects.toThrow('permission-revoked');
});

test.each(['manual', 'routine', 'trusted'] as AppAuthorizationLevel[])('%s applies only to explicit signer operations', level => {
  expect(automaticallyAllowsSigning(level, { ...request, operation: 'future-method' } as unknown as SigningRequest)).toBe(false);
});

test('Routine allows only its fixed event kinds and general encryption, never decryption or HTTP auth', () => {
  const allowed = new Set([1, 4, 6, 7, 13, 16, 1059]);
  for (let kind = 0; kind <= 65535; kind++) {
    expect(automaticallyAllowsSigning('routine', { ...request, kind })).toBe(allowed.has(kind));
  }
  for (const operation of ['get-public-key', 'nip04-encrypt', 'nip44-encrypt'] as const)
    expect(automaticallyAllowsSigning('routine', { operation, relays: [] })).toBe(true);
  for (const operation of ['nip04-decrypt', 'nip44-decrypt'] as const)
    expect(automaticallyAllowsSigning('routine', { operation, relays: [] })).toBe(false);
  expect(automaticallyAllowsSigning('routine', { ...request, operation: 'http-auth', kind: 27235 })).toBe(false);
  expect(automaticallyAllowsSigning('routine', { ...request, operation: 'upload', kind: 24242 })).toBe(false);
  expect(automaticallyAllowsSigning('trusted', { ...request, kind: 65535 })).toBe(true);
  expect(automaticallyAllowsSigning('routine', { ...request, kind: 22242 })).toBe(false);
  expect(automaticallyAllowsSigning('routine', { ...request, operation: 'relay-auth', kind: 22242 })).toBe(true);
});

test('concurrent first opens share a level choice, with no signing request required', async () => {
  const life = new AbortController(); controllers.push(life);
  const choose = jest.fn(async () => 'routine');
  await Promise.all([ensureAppAuthorizationLevel(scope, choose, life.signal), ensureAppAuthorizationLevel(scope, choose, life.signal)]);
  expect(choose).toHaveBeenCalledTimes(1);
  expect(levels.get(scopeId)).toBe('routine');
});

test('account requests reuse the level selected at launch', async () => {
  const life = new AbortController(); controllers.push(life);
  await ensureAppAuthorizationLevel(scope, async () => 'routine', life.signal);
  const value = create();
  await value.permissions.authorizeAccess('get-public-key');
  expect(value.choose).not.toHaveBeenCalled();
  expect(value.confirm).not.toHaveBeenCalled();
});

test('a reset during first-open selection cannot save its stale answer', async () => {
  const life = new AbortController(); controllers.push(life);
  let finish!: (answer: string) => void;
  const pending = ensureAppAuthorizationLevel(scope, () => new Promise<string>(resolve => { finish = resolve; }), life.signal);
  while (!finish) await new Promise(resolve => setTimeout(resolve, 0));
  await memoryRepository.clearSigningPermissions(scope);
  finish('trusted');
  await expect(pending).rejects.toThrow('permission-revoked');
  expect(levels.get(scopeId)).toBeUndefined();
});

test('only declared basic capabilities gain automatic access, and a downgrade restores denials', () => {
  const release = { required: ['resource'], optional: ['storage', 'config', 'inc'] };
  const denied = ['storage'];
  const automatic = resolveDomainPermissions(release, [], denied, 'routine');
  expect(automatic).toEqual(expect.arrayContaining(['resource', 'storage', 'config']));
  expect(automatic).not.toContain('inc');
  const manual = resolveDomainPermissions(release, [], denied, 'manual');
  expect(manual).not.toContain('resource');
  expect(manual).not.toContain('storage');
  for (const level of ['routine', 'trusted'] as const) {
    expect(automaticallyAllowsAccess(level, 'network')).toBe(true);
    expect(automaticallyAllowsAccess(level, 'camera')).toBe(false);
    expect(automaticallyAllowsAccess(level, 'dev')).toBe(false);
    expect(automaticallyAllowsAccess(level, 'unknown')).toBe(false);
  }
});

test.each([undefined, 'manual', 'routine', 'trusted'] as const)('classifies wallet information explicitly at level %s', level => {
  expect(automaticallyAllowsWalletInfo(level)).toBe(level === 'routine' || level === 'trusted');
});
