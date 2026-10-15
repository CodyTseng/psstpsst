import { encodeSigningRules } from '../signing-permissions';
import { NappletRuntime } from '../runtime';
import { nappletService, nappletStore } from '../service';
import { getData, setData, installations, type AppScope } from '../repository';
import type { NappletInstallation } from '../protocol';

jest.mock('@/db/client', () => ({ db: {} }));
jest.mock('@/services/account/account-access', () => ({ getAccount: jest.fn(async () => ({ pubkey: 'accountA' })) }));
jest.mock('../artifacts', () => ({ loadArtifact: jest.fn(async () => '') }));
jest.mock('../network', () => ({ NappletNetwork: jest.fn(() => ({ destroy: jest.fn() })) }));
jest.mock('../repository', () => ({ getData: jest.fn(), setData: jest.fn(), installations: jest.fn(), markRecent: jest.fn(async () => {}) }));
jest.mock('../runtime', () => ({ NappletRuntime: jest.fn((options) => ({
  scope: { accountPubkey: options.accountPubkey, appKey: options.release.key, artifactHash: options.release.hash },
  open: jest.fn(async () => 'container'), close: jest.fn(async () => {}),
  signingPermissions: { revoke: jest.fn(async () => {}), settled: jest.fn(async () => {}), snapshot: jest.fn(async () => ({ rules: [], activity: [] })) },
})) }));

const stored = new Map<string, string>();
const key = (scope: AppScope, bucket: string, name: string) => JSON.stringify([scope, bucket, name]);
const app = { key: 'app', hash: 'v1', title: 'App', required: ['storage'], optional: ['identity'], event: { pubkey: 'publisher' } } as NappletInstallation;
const scope = { accountPubkey: 'accountA', appKey: app.key, artifactHash: app.hash };

beforeEach(async () => {
  nappletService.deactivate(); stored.clear(); jest.clearAllMocks();
  jest.mocked(getData).mockImplementation(async (s, bucket, name) => stored.get(key(s, bucket, name)) ?? null);
  jest.mocked(setData).mockImplementation(async (s, bucket, name, value) => {
    if (value == null) stored.delete(key(s, bucket, name)); else stored.set(key(s, bucket, name), value);
  });
  jest.mocked(installations).mockResolvedValue([app]);
  await nappletService.activate('accountA');
  nappletService.updateTheme({ colors: { background: '', text: '', primary: '' } });
});
afterEach(() => nappletService.deactivate());

it('grants only required domains when the user leaves optional capabilities disabled', async () => {
  const opening = nappletService.open(app);
  for (let i = 0; i < 20 && !nappletStore.getState().prompt; i++) await Promise.resolve();
  const prompt = nappletStore.getState().prompt!;
  expect(prompt.capabilities).toEqual({ required: ['shell', 'storage'], optional: ['identity'] });
  nappletService.answer(prompt.requestId, 'domains:[]');
  await opening;
  expect(JSON.parse(stored.get(key(scope, 'permissions', 'domains'))!)).toEqual(['shell', 'storage']);
});

it('revokes only the selected rule for the selected account and artifact', async () => {
  const rules = [{ key: 'remove', duration: 'always' }, { key: 'keep', duration: 'always' }];
  stored.set(key(scope, 'permissions', 'signing'), encodeSigningRules(rules as never));
  const otherAccount = { ...scope, accountPubkey: 'accountB' };
  const otherVersion = { ...scope, artifactHash: 'v2' };
  stored.set(key(otherAccount, 'permissions', 'signing'), encodeSigningRules(rules as never));
  stored.set(key(otherVersion, 'permissions', 'signing'), encodeSigningRules(rules as never));
  await nappletService.revokeSigningRule(app, 'remove', 'accountA');
  expect(JSON.parse(stored.get(key(scope, 'permissions', 'signing'))!).rules).toEqual([rules[1]]);
  expect(JSON.parse(stored.get(key(otherAccount, 'permissions', 'signing'))!)).toEqual({ version: 3, rules });
  expect(JSON.parse(stored.get(key(otherVersion, 'permissions', 'signing'))!)).toEqual({ version: 3, rules });
});

it('ignores stale account management actions and resets both access and signing grants', async () => {
  stored.set(key(scope, 'permissions', 'domains'), '["shell"]');
  stored.set(key(scope, 'permissions', 'signing'), '[]');
  stored.set(key(scope, 'storage', 'progress'), 'preserve');
  await expect(nappletService.revokeSigningRule(app, 'remove', 'accountB')).rejects.toThrow('session-closed');
  expect(setData).not.toHaveBeenCalled();
  await nappletService.revoke(app, 'accountA');
  expect(stored.has(key(scope, 'permissions', 'domains'))).toBe(false);
  expect(stored.has(key(scope, 'permissions', 'signing'))).toBe(false);
  expect(stored.get(key(scope, 'storage', 'progress'))).toBe('preserve');
});

it('revokes the running app cache without closing its container', async () => {
  stored.set(key(scope, 'permissions', 'domains'), '["shell","storage"]');
  await nappletService.open(app);
  const active = jest.mocked(NappletRuntime).mock.results.at(-1)!.value;
  await nappletService.revokeSigningRule(app, 'remove', 'accountA');
  expect(active.signingPermissions.revoke).toHaveBeenCalledWith('remove');
  expect(active.close).not.toHaveBeenCalled();
  expect(nappletStore.getState().running?.containerId).toBe('container');
});

it('keeps the native app hidden until the host sheet has finished exiting', async () => {
  stored.set(key(scope, 'permissions', 'domains'), '["shell","storage"]');
  await nappletService.open(app);
  nappletService.openPanel('about');
  expect(nappletStore.getState().overlayActive).toBe(true);
  nappletService.closePanel();
  expect(nappletStore.getState().overlayActive).toBe(true);
  nappletService.overlayClosed();
  expect(nappletStore.getState().overlayActive).toBe(false);
});

it('preserves required domains, reloads changed app access and isolates stale accounts', async () => {
  stored.set(key(scope, 'permissions', 'domains'), '["shell","storage"]');
  await nappletService.open(app);
  nappletService.openPanel('settings');
  const active = jest.mocked(NappletRuntime).mock.results.at(-1)!.value;
  await expect(nappletService.setDomainPermissions(app, ['shell'], 'accountA')).rejects.toThrow('required-permission');
  await expect(nappletService.setDomainPermissions(app, ['shell', 'storage'], 'accountB')).rejects.toThrow('session-closed');
  await nappletService.setDomainPermissions(app, ['shell', 'storage', 'identity'], 'accountA');
  expect(active.close).toHaveBeenCalledTimes(1);
  expect(JSON.parse(stored.get(key(scope, 'permissions', 'domains'))!)).toEqual(['shell', 'storage', 'identity']);
  expect(nappletStore.getState().panel?.page).toBe('settings');
});

it('shares without replacing the execution container and resumes only its own session', async () => {
  stored.set(key(scope, 'permissions', 'domains'), '["shell","storage"]');
  await nappletService.open(app);
  const active = jest.mocked(NappletRuntime).mock.results.at(-1)!.value;
  nappletService.startShare('accountA', app);
  expect(nappletStore.getState().sharing).toBe(true);
  expect(active.close).not.toHaveBeenCalled();
  nappletService.closeShare('accountA', 'obsolete-container');
  expect(nappletStore.getState().sharing).toBe(true);
  nappletService.closeShare('accountA', 'container');
  expect(nappletStore.getState().sharing).toBe(false);
  expect(nappletStore.getState().running?.containerId).toBe('container');
});
