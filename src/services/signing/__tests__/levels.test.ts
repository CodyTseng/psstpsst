import { SigningPermissions, signingRuleKey, type SigningRequest } from '../permissions';
import { automaticallyAllowsSigning, automaticallyAllowsAccess, automaticallyAllowsWalletInfo, EVERYDAY_SIGNING } from '@/services/app-authorization/policy';
import { memoryRepository, authorizations, rules, activity } from '../testing/memory-repository';
import { initializeAppAuthorization, setFullyTrusted } from '../repository';
import { ApplicationSigner } from '../application-signer';
import type { Signer } from '@/services/signer/signer.interface';
import { ensureAppAuthorization } from '@/services/app-authorization/initialize';
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
  jest.clearAllMocks(); authorizations.clear(); rules.clear(); activity.clear();
  authorizations.set(scopeId, undefined);
});
afterEach(() => controllers.splice(0).forEach(life => life.abort()));

test.each(['manual', 'routine', 'trusted'] as const)('first use initializes %s without persisting the preset', async preset => {
  const value = create(jest.fn(async () => preset));
  await value.permissions.authorize(request);
  expect(value.choose).toHaveBeenCalledTimes(1);
  expect(value.confirm).toHaveBeenCalledTimes(preset === 'manual' ? 1 : 0);
  expect(authorizations.get(scopeId)).toEqual({ fullyTrusted: preset === 'trusted' });
  expect(rules.get(scopeId) ?? []).toHaveLength(preset === 'routine' ? EVERYDAY_SIGNING.length : 0);
  const next = create();
  await next.permissions.authorize(request);
  expect(next.choose).not.toHaveBeenCalled();
});

test.each([false, 'allow-always', 'invalid'] as const)('cancelled or invalid initialization (%s) saves nothing', async answer => {
  const value = create(jest.fn(async () => answer));
  await expect(value.permissions.authorize(request)).rejects.toThrow('permission-denied');
  expect(authorizations.get(scopeId)).toBeUndefined();
  expect(value.confirm).not.toHaveBeenCalled();
  expect(activity.get(scopeId)).toBeUndefined();
});

test('concurrent controllers initialize once and use the resulting ordinary rules', async () => {
  const first = create(); const second = create();
  await Promise.all([first.permissions.authorize(request), second.permissions.authorize(request)]);
  expect(first.choose).toHaveBeenCalledTimes(1);
  expect(second.choose).not.toHaveBeenCalled();
  expect(first.confirm).not.toHaveBeenCalled();
  expect(second.confirm).not.toHaveBeenCalled();
});

test('Everyday use still reviews sensitive operations after initialization', async () => {
  const value = create();
  await value.permissions.authorize({ ...request, kind: 5 });
  expect(value.choose.mock.invocationCallOrder[0]).toBeLessThan(value.confirm.mock.invocationCallOrder[0]);
  expect(value.confirm).toHaveBeenCalledTimes(1);
});

test.each(['deny', 'ask'] as const)('an Everyday use grant can be changed to %s immediately', async decision => {
  const value = create();
  await value.permissions.authorize(request);
  await value.permissions.edit({ key: signingRuleKey(request), scope: request }, { decision, duration: 'always' });
  if (decision === 'deny') await expect(value.permissions.authorize(request)).rejects.toThrow('permission-denied');
  else { await value.permissions.authorize(request); expect(value.confirm).toHaveBeenCalledTimes(1); }
  expect((await value.permissions.snapshot()).rules.find(rule => rule.key === signingRuleKey(request))?.decision).toBe(decision);
});

test('full trust pauses refusals, preserves rules and restores them when disabled', async () => {
  const value = create();
  await value.permissions.authorize(request);
  await value.permissions.edit({ key: signingRuleKey(request), scope: request }, { decision: 'deny', duration: 'always' });
  await setFullyTrusted(scope, true);
  await value.permissions.authorize({ ...request, kind: 65535 });
  await value.permissions.authorize(request);
  expect(value.confirm).not.toHaveBeenCalled();
  expect(rules.get(scopeId)?.find(rule => rule.key === signingRuleKey(request))?.decision).toBe('deny');
  await setFullyTrusted(scope, false);
  await expect(value.permissions.authorize(request)).rejects.toThrow('permission-denied');
});

test('disabling initially selected full trust falls back to asking, without generating Everyday rules', async () => {
  const value = create(jest.fn(async () => 'trusted'));
  await value.permissions.authorize(request);
  await setFullyTrusted(scope, false);
  await value.permissions.authorize(request);
  expect(value.confirm).toHaveBeenCalledTimes(1);
  expect(rules.get(scopeId) ?? []).toEqual([]);
});

test('changing trust clears session approvals rather than restoring them later', async () => {
  const value = create(jest.fn(async () => 'manual'), jest.fn(async () => 'allow-session'));
  await value.permissions.authorize(request);
  expect((await value.permissions.snapshot()).rules[0].duration).toBe('session');
  await setFullyTrusted(scope, true);
  await setFullyTrusted(scope, false);
  await value.permissions.authorize(request);
  expect(value.confirm).toHaveBeenCalledTimes(2);
});

test('an expired replacement rule asks again instead of regenerating an Everyday grant', async () => {
  await initializeAppAuthorization(scope, 'routine');
  const target = { key: signingRuleKey(request), scope: request };
  rules.set(scopeId, [{ ...target, duration: 'timed', decision: 'allow', expiresAt: Date.now() - 1, createdAt: 1 }]);
  const value = create();
  await value.permissions.authorize(request);
  expect(value.confirm).toHaveBeenCalledTimes(1);
});

test('failed initialization cannot return account authority', async () => {
  const value = create();
  memoryRepository.initializeAppAuthorization.mockRejectedValueOnce(new Error('disk-full'));
  await expect(value.permissions.authorize(request)).rejects.toThrow('disk-full');
  expect(authorizations.get(scopeId)).toBeUndefined();
  expect(value.confirm).not.toHaveBeenCalled();
});

test('account mismatches and invalid requests cannot initialize authority', async () => {
  const value = create();
  await expect(value.permissions.authorize({ ...request, accountPubkey: 'other' })).rejects.toThrow('account-unavailable');
  await expect(value.permissions.authorize({ ...request, kind: 65536 })).rejects.toThrow('invalid-signing-request');
  expect(value.choose).not.toHaveBeenCalled();
});

test('reset removes initialization and rejects an outstanding chooser response', async () => {
  const value = create();
  await value.permissions.authorize(request);
  await memoryRepository.clearSigningPermissions(scope);
  await value.permissions.authorize(request);
  expect(value.choose).toHaveBeenCalledTimes(2);
  await memoryRepository.clearSigningPermissions(scope);
  let resolve!: (value: string) => void;
  const cancelled = create(jest.fn(() => new Promise<string>(done => { resolve = done; })));
  const pending = cancelled.permissions.authorize(request);
  while (!resolve) await new Promise(done => setTimeout(done, 0));
  await memoryRepository.clearSigningPermissions(scope);
  resolve('trusted');
  await expect(pending).rejects.toThrow('permission-denied');
  expect(authorizations.get(scopeId)).toBeUndefined();
});

test('disabling trust withholds a signature already being computed', async () => {
  authorizations.set(scopeId, { fullyTrusted: true });
  const value = create();
  let resolve!: (event: unknown) => void;
  const signer = { signEvent: jest.fn(() => new Promise(done => { resolve = done; })) } as unknown as Signer;
  const application = new ApplicationSigner({ permissions: value.permissions, accountPubkey: 'account', signer: async () => signer, current: () => {} });
  const pending = application.signEvent({ kind: 1, content: '', tags: [], created_at: 100 }, template => signer.signEvent(template));
  while (!resolve) await new Promise(done => setTimeout(done, 0));
  await setFullyTrusted(scope, false);
  resolve({ id: 'signed' });
  await expect(pending).rejects.toThrow('permission-revoked');
});

test('trust covers only known host methods and never device or unknown access', () => {
  const trusted = { fullyTrusted: true };
  expect(automaticallyAllowsSigning(trusted, { ...request, kind: 65535 })).toBe(true);
  expect(automaticallyAllowsSigning(trusted, { ...request, operation: 'future-method' } as unknown as SigningRequest)).toBe(false);
  for (const domain of ['camera', 'dev', 'unknown']) expect(automaticallyAllowsAccess(trusted, domain)).toBe(false);
  expect(automaticallyAllowsAccess(trusted, 'network')).toBe(true);
  expect(automaticallyAllowsWalletInfo(trusted)).toBe(true);
  expect(automaticallyAllowsWalletInfo({ fullyTrusted: false })).toBe(false);
});

test('first open initializes once even without a signer call', async () => {
  const life = new AbortController(); controllers.push(life);
  const choose = jest.fn(async () => 'routine');
  await Promise.all([ensureAppAuthorization(scope, choose, life.signal), ensureAppAuthorization(scope, choose, life.signal)]);
  const value = create();
  await value.permissions.authorizeAccess('get-public-key');
  expect(choose).toHaveBeenCalledTimes(1);
  expect(value.choose).not.toHaveBeenCalled();
  expect(value.confirm).not.toHaveBeenCalled();
});

test('reset during first-open initialization cannot save a stale selection', async () => {
  const life = new AbortController(); controllers.push(life);
  let finish!: (answer: string) => void;
  const pending = ensureAppAuthorization(scope, () => new Promise<string>(resolve => { finish = resolve; }), life.signal);
  while (!finish) await new Promise(resolve => setTimeout(resolve, 0));
  await memoryRepository.clearSigningPermissions(scope);
  finish('trusted');
  await expect(pending).rejects.toThrow('permission-revoked');
});

test('optional Everyday access can be denied and full trust temporarily bypasses that denial', () => {
  const release = { required: ['resource'], optional: ['storage', 'config', 'inc'] };
  expect(resolveDomainPermissions(release, ['resource', 'storage'], ['storage'], { fullyTrusted: false })).not.toContain('storage');
  expect(resolveDomainPermissions(release, [], ['storage'], { fullyTrusted: true })).toEqual(expect.arrayContaining(['resource', 'storage', 'config']));
  expect(resolveDomainPermissions(release, [], [], { fullyTrusted: true })).not.toContain('inc');
});
