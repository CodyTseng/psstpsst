import { clearBrowserPermissions } from '@/services/explore/browser-permission-store';
import { rules as signingRules, activity as signingActivity } from '@/services/signing/testing/memory-repository';
import { signingRuleKey } from '../signing-permissions';
import { NappletRuntime } from '../runtime';
import { loadArtifact } from '../artifacts';
import { NappletNetwork } from '../network';
import { finalizeEvent, generateSecretKey } from 'nostr-tools';
import { naddrEncode, neventEncode, noteEncode } from 'nostr-tools/nip19';
import { nappletService, nappletStore } from '../service';
import { getData, setData, installations, saveDesktopOrder, clearRecent, type AppScope } from '../repository';
import { parseManifest, type NappletInstallation } from '../protocol';
import typeZoo from './fixtures/type-zoo-legacy.json';

jest.mock('@/services/explore/browser-permission-store', () => ({ clearBrowserPermissions: jest.fn(async () => {}), clearAccountBrowserPermissions: jest.fn(async () => {}) }));
jest.mock('@/services/signing/repository', () => jest.requireActual('../../signing/testing/memory-repository').memoryRepository);
jest.mock('@/services/signing/source', () => ({ signingSourceFromLegacyKey: (key: string) => `${key}.example` }));
jest.mock('@/db/client', () => ({ db: {} }));
jest.mock('@/services/account/account-access', () => ({ getAccount: jest.fn(async () => ({ pubkey: 'accountA' })) }));
jest.mock('../artifacts', () => ({ loadArtifact: jest.fn(async () => '') }));
jest.mock('../network', () => ({ NappletNetwork: jest.fn(() => ({ destroy: jest.fn(), query: jest.fn(), publisherRelays: jest.fn(async () => []) })) }));
jest.mock('../repository', () => ({ clearRecent: jest.fn(async () => {}), saveDesktopOrder: jest.fn(async () => {}), getData: jest.fn(), setData: jest.fn(), installations: jest.fn(), saveInstallation: jest.fn(async () => {}), markRecent: jest.fn(async () => {}) }));
jest.mock('../runtime', () => ({ NappletRuntime: jest.fn((options) => ({
  scope: { accountPubkey: options.accountPubkey, appKey: options.release.key },
  open: jest.fn(async () => 'container'), close: jest.fn(async () => {}),
  goBack: jest.fn(async () => true),
  signingPermissions: { revoke: jest.fn(async () => {}), edit: jest.fn(async () => {}), settled: jest.fn(async () => {}), snapshot: jest.fn(async () => ({ rules: [], activity: [] })) },
})) }));

const stored = new Map<string, string>();
const key = (scope: AppScope, bucket: string, name: string) => JSON.stringify([scope, bucket, name]);
const app = { key: 'app', hash: 'v1', title: 'App', required: ['storage'], optional: ['identity'], event: { pubkey: 'publisher' } } as NappletInstallation;
const scope = { accountPubkey: 'accountA', appKey: app.key };

beforeEach(async () => {
  nappletService.deactivate(); stored.clear(); signingRules.clear(); signingActivity.clear(); jest.clearAllMocks();
  jest.mocked(getData).mockImplementation(async (s, bucket, name) => stored.get(key(s, bucket, name)) ?? null);
  jest.mocked(setData).mockImplementation(async (s, bucket, name, value) => {
    if (value == null) stored.delete(key(s, bucket, name)); else stored.set(key(s, bucket, name), value);
  });
  jest.mocked(installations).mockResolvedValue([app]);
  await nappletService.activate('accountA');
  nappletService.updateTheme({ colors: { background: '', text: '', primary: '' } });
});
afterEach(() => nappletService.deactivate());

it('serializes independent signing-table edits and isolates accounts', async () => {
  const first = { key: signingRuleKey({ operation: 'publish', kind: 1, relays: [] }), scope: { operation: 'publish' as const, kind: 1, relays: [] } };
  const second = { key: signingRuleKey({ operation: 'publish', kind: 7, relays: [] }), scope: { operation: 'publish' as const, kind: 7, relays: [] } };
  await Promise.all([
    nappletService.updateSigningRule(app, first, { decision: 'allow', duration: 'always' }, 'accountA'),
    nappletService.updateSigningRule(app, second, { decision: 'deny', duration: 'always' }, 'accountA'),
  ]);
  expect(signingRules.get(JSON.stringify({ accountPubkey: 'accountA', sourceId: 'app.example' }))).toHaveLength(2);
  await nappletService.updateSigningRule(app, first, { decision: 'ask', duration: 'always' }, 'accountA');
  expect(signingRules.get(JSON.stringify({ accountPubkey: 'accountA', sourceId: 'app.example' }))![0].key).toBe(second.key);
  expect(stored.has(key(scope, 'permissions', 'signing'))).toBe(false);
  await expect(nappletService.updateSigningRule(app, first, { decision: 'allow', duration: 'always' }, 'accountB')).rejects.toThrow('session-closed');
});

it('updates a live runtime through its permission cache', async () => {
  stored.set(key(scope, 'permissions', 'domains'), '["shell","storage"]');
  await nappletService.open(app);
  const active = jest.mocked(NappletRuntime).mock.results.at(-1)!.value;
  const target = { key: signingRuleKey({ operation: 'publish', kind: 1, relays: [] }), scope: { operation: 'publish' as const, kind: 1, relays: [] } };
  await nappletService.updateSigningRule(app, target, { decision: 'deny', duration: 'always' }, 'accountA');
  expect(active.signingPermissions.edit).toHaveBeenCalledWith(target, { decision: 'deny', duration: 'always' });
  expect(active.close).not.toHaveBeenCalled();
});

function addressFixture(relays: string[] = []) {
  const signer = generateSecretKey();
  const event = finalizeEvent({ kind: 35129, created_at: 100, content: 'Address lookup fixture',
    tags: [['d', 'CaseSensitive/应用'], ['x', 'a'.repeat(64)]] }, signer);
  return { event, signer, address: naddrEncode({ kind: event.kind, pubkey: event.pubkey, identifier: 'CaseSensitive/应用', relays }) };
}

function lookupNetwork() {
  const network = { destroy: jest.fn(), query: jest.fn(), publisherRelays: jest.fn(async () => [] as string[]) };
  jest.mocked(NappletNetwork).mockImplementationOnce(() => network as unknown as NappletNetwork);
  return network;
}

it('resolves installed apps locally for scanned addresses, pasted IDs and share links', async () => {
  const { event, address } = addressFixture(['wss://publisher.example/']);
  const release = parseManifest(event) as NappletInstallation;
  nappletStore.setState({ installed: [release] });
  const connections = jest.mocked(NappletNetwork).mock.calls.length;
  for (const input of [address, `nostr:${address}`, `https://napplet.example/${address}`,
    event.id, neventEncode({ id: event.id, relays: ['wss://publisher.example/'] }), noteEncode(event.id)]) {
    expect(await nappletService.resolve(input)).toBe(release);
  }
  expect(NappletNetwork).toHaveBeenCalledTimes(connections);
});

it('uses the newest locally known coordinate without substituting an exact event ID', async () => {
  const { event, address, signer } = addressFixture();
  const newer = finalizeEvent({ kind: event.kind, content: event.content, tags: event.tags,
    created_at: event.created_at + 1 }, signer);
  // A different publisher with the same identifier must not match.
  const unrelated = finalizeEvent({ kind: event.kind, content: event.content, tags: event.tags,
    created_at: event.created_at + 2 }, generateSecretKey());
  const installed = parseManifest(event) as NappletInstallation;
  const latest = parseManifest(newer);
  nappletStore.setState({ installed: [installed], market: [parseManifest(unrelated), latest] });
  expect(await nappletService.resolve(address)).toBe(latest);
  expect(await nappletService.resolve(event.id)).toBe(installed);
});

it('caches relay results for both entry paths and explicitly refreshes for update checks', async () => {
  const { event, address } = addressFixture();
  const network = lookupNetwork();
  network.query.mockResolvedValue({ events: [event], incomplete: false });
  const release = await nappletService.resolve(address);
  expect(await nappletService.resolve(address)).toBe(release);
  expect(await nappletService.resolve(event.id)).toBe(release);
  expect(network.query).toHaveBeenCalledTimes(1);
  const update = lookupNetwork();
  update.query.mockResolvedValue({ events: [event], incomplete: false });
  await nappletService.resolve(address, { refresh: true });
  expect(update.query).toHaveBeenCalledTimes(1);
});

it('does not reuse a previous account app lookup cache', async () => {
  const { event, address } = addressFixture();
  nappletStore.setState({ market: [parseManifest(event)] });
  await nappletService.activate('accountB');
  const network = lookupNetwork();
  network.query.mockResolvedValue({ events: [], incomplete: false });
  await expect(nappletService.resolve(address)).rejects.toThrow('napplets.not_found');
  expect(network.query).toHaveBeenCalled();
});

it('resolves and installs the legacy Type Zoo listing with its required upload capability', async () => {
  const network = lookupNetwork();
  network.query.mockResolvedValue({ events: [typeZoo], incomplete: false });
  const address = naddrEncode({ kind: 35129, pubkey: typeZoo.pubkey, identifier: 'type-zoo', relays: ['wss://relay.damus.io/'] });
  const release = await nappletService.resolve(address);
  expect(release.required).toContain('upload');
  await expect(nappletService.install(release)).resolves.toBeUndefined();
  expect(loadArtifact).toHaveBeenCalled();
});

it('queries embedded relay hints with the complete address coordinate', async () => {
  const { event, address } = addressFixture(['wss://publisher.example/apps']);
  const network = lookupNetwork();
  network.query.mockResolvedValue({ events: [event], incomplete: false });
  expect((await nappletService.resolve(address)).event.id).toBe(event.id);
  expect(network.query.mock.calls[0][0][0]).toBe('wss://publisher.example/apps');
  expect(network.query.mock.calls[0][1]).toEqual([{ kinds: [35129], authors: [event.pubkey], '#d': ['CaseSensitive/应用'], limit: 1 }]);
  expect(network.publisherRelays).not.toHaveBeenCalled();
  expect(network.destroy).toHaveBeenCalledTimes(1);
});

it('falls back to the publisher write relays when an address has no relay hints', async () => {
  const { event, address } = addressFixture();
  const network = lookupNetwork();
  network.query.mockResolvedValueOnce({ events: [], incomplete: false }).mockResolvedValueOnce({ events: [event], incomplete: false });
  network.publisherRelays.mockResolvedValue(['wss://nos.lol/', 'wss://author-write.example/']);
  expect((await nappletService.resolve(address)).event.id).toBe(event.id);
  expect(network.publisherRelays).toHaveBeenCalledWith(event.pubkey);
  expect(network.query.mock.calls[1]).toEqual([['wss://author-write.example/'], network.query.mock.calls[0][1]]);
});

it('avoids an author relay-list lookup when the normal query already found the app', async () => {
  const { event, address } = addressFixture();
  const network = lookupNetwork();
  network.query.mockResolvedValue({ events: [event], incomplete: false });
  expect((await nappletService.resolve(address)).event.id).toBe(event.id);
  expect(network.publisherRelays).not.toHaveBeenCalled();
});

it.each([
  [{ events: [], incomplete: false }, 'napplets.not_found'],
  [{ events: [], incomplete: true, error: 'network-error' }, 'napplets.request_failed'],
  [{ events: [{}], incomplete: false }, 'napplets.invalid_manifest'],
])('distinguishes empty reads, failed reads and rejected manifests', async (result, reason) => {
  const { address } = addressFixture(['wss://publisher.example/']);
  const network = lookupNetwork();
  network.query.mockResolvedValue(result);
  await expect(nappletService.resolve(address)).rejects.toThrow(reason);
  expect(network.destroy).toHaveBeenCalledTimes(1);
});

it('does not query a previous account publisher after an account switch', async () => {
  const { address } = addressFixture();
  const network = lookupNetwork();
  network.query.mockResolvedValue({ events: [], incomplete: false });
  let finish!: (relays: string[]) => void;
  network.publisherRelays.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const pending = nappletService.resolve(address);
  const rejected = expect(pending).rejects.toThrow('session-closed');
  for (let i = 0; i < 10 && !finish; i++) await Promise.resolve();
  await nappletService.activate('accountB');
  finish(['wss://author-write.example/']);
  await rejected;
  expect(network.query).toHaveBeenCalledTimes(1);
  expect(network.destroy).toHaveBeenCalledTimes(1);
});

it('shows cold-download feedback until its own runtime presents and leaves cached launches quiet', async () => {
  stored.set(key(scope, 'permissions', 'domains'), '["shell","storage"]');
  jest.mocked(loadArtifact).mockImplementationOnce(async (_release, _signal, onDownload) => { onDownload?.(); return ''; });
  await nappletService.open(app);
  expect(nappletStore.getState().launch?.showLoading).toBe(true);
  const firstOptions = jest.mocked(NappletRuntime).mock.calls.at(-1)![0];
  firstOptions.presented?.();
  expect(nappletStore.getState().launch?.showLoading).toBe(false);
  await nappletService.open(app);
  expect(nappletStore.getState().launch?.showLoading).toBe(false);
  jest.mocked(loadArtifact).mockImplementationOnce(async (_release, _signal, onDownload) => { onDownload?.(); return ''; });
  await nappletService.open(app);
  expect(nappletStore.getState().launch?.showLoading).toBe(true);
  firstOptions.presented?.();
  expect(nappletStore.getState().launch?.showLoading).toBe(true);
  jest.mocked(NappletRuntime).mock.calls.at(-1)![0].presented?.();
  expect(nappletStore.getState().launch?.showLoading).toBe(false);
});

async function settleLaunch() {
  for (let i = 0; i < 40 && nappletStore.getState().launching; i++) await Promise.resolve();
}

it('prepares navigation without starting installation, permissions or the runtime', async () => {
  stored.set(key(scope, 'permissions', 'domains'), '["shell","storage"]');
  const runId = nappletService.prepareOpen(app, 'accountA');
  expect(nappletService.prepareOpen(app, 'accountA')).toBe(runId);
  expect(nappletStore.getState()).toMatchObject({ runId, launching: true, launch: { release: app, pending: true, error: null } });
  expect(loadArtifact).not.toHaveBeenCalled();
  expect(NappletRuntime).not.toHaveBeenCalled();
  expect(nappletStore.getState().prompt).toBe(null);
  nappletService.startPreparedOpen(runId);
  nappletService.startPreparedOpen(runId);
  await settleLaunch();
  expect(NappletRuntime).toHaveBeenCalledTimes(1);
  expect(nappletStore.getState().running?.release).toBe(app);
});

it('keeps download failures available for retry inside the same container run', async () => {
  stored.set(key(scope, 'permissions', 'domains'), '["shell","storage"]');
  jest.mocked(loadArtifact).mockRejectedValueOnce(new Error('napplets.download_failed'));
  const runId = nappletService.prepareOpen(app, 'accountA');
  nappletService.startPreparedOpen(runId);
  await settleLaunch();
  expect(nappletStore.getState()).toMatchObject({ runId, launching: false, running: null, launch: { error: 'napplets.download_failed' } });
  nappletService.retryOpen(runId);
  expect(nappletStore.getState().launch?.pending).toBe(true);
  nappletService.startPreparedOpen(runId);
  await settleLaunch();
  expect(nappletStore.getState()).toMatchObject({ runId, launching: false, launch: { error: null }, running: { containerId: 'container' } });
});

it('rejects stale accounts and prevents an old route from starting or stopping a newer run', async () => {
  expect(() => nappletService.prepareOpen(app, 'accountB')).toThrow('session-closed');
  const first = nappletService.prepareOpen(app, 'accountA');
  const second = nappletService.prepareOpen({ ...app, key: 'another-app' }, 'accountA');
  nappletService.stop(first);
  nappletService.startPreparedOpen(first);
  expect(nappletStore.getState()).toMatchObject({ runId: second, launching: true });
  expect(NappletRuntime).not.toHaveBeenCalled();
  nappletService.stop(second);
  nappletService.startPreparedOpen(second);
  expect(nappletStore.getState().launch).toBe(null);
  await nappletService.activate('accountB');
  nappletService.startPreparedOpen(second);
  expect(NappletRuntime).not.toHaveBeenCalled();
});

it('discards download completion after the loading container was closed', async () => {
  stored.set(key(scope, 'permissions', 'domains'), '["shell","storage"]');
  let finish!: (html: string) => void;
  jest.mocked(loadArtifact).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const runId = nappletService.prepareOpen(app, 'accountA');
  nappletService.startPreparedOpen(runId);
  for (let i = 0; i < 20 && !finish; i++) await Promise.resolve();
  nappletService.stop(runId);
  finish('html');
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(NappletRuntime).not.toHaveBeenCalled();
  expect(nappletStore.getState()).toMatchObject({ running: null, launching: false, launch: null });
});

it('keeps the app running after internal back and stops only at its root', async () => {
  stored.set(key(scope, 'permissions', 'domains'), '["shell","storage"]');
  await nappletService.open(app);
  const active = jest.mocked(NappletRuntime).mock.results.at(-1)!.value;
  await nappletService.goBack();
  expect(active.goBack).toHaveBeenCalledTimes(1);
  expect(active.close).not.toHaveBeenCalled();
  active.goBack.mockResolvedValueOnce(false);
  await nappletService.goBack();
  expect(active.close).toHaveBeenCalledTimes(1);
  expect(nappletStore.getState().running).toBe(null);
});

it('coalesces pending back presses and ignores a result from a replaced runtime', async () => {
  stored.set(key(scope, 'permissions', 'domains'), '["shell","storage"]');
  await nappletService.open(app);
  const active = jest.mocked(NappletRuntime).mock.results.at(-1)!.value;
  let resolve!: (handled: boolean) => void;
  active.goBack.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const pending = nappletService.goBack();
  await nappletService.goBack();
  expect(active.goBack).toHaveBeenCalledTimes(1);
  await nappletService.open(app);
  const replacement = jest.mocked(NappletRuntime).mock.results.at(-1)!.value;
  resolve(false);
  await pending;
  expect(replacement.close).not.toHaveBeenCalled();
  nappletService.openPanel('about');
  await nappletService.goBack();
  expect(replacement.goBack).not.toHaveBeenCalled();
});

it('does not close the app if host UI opens while back navigation is pending', async () => {
  stored.set(key(scope, 'permissions', 'domains'), '["shell","storage"]');
  await nappletService.open(app);
  const active = jest.mocked(NappletRuntime).mock.results.at(-1)!.value;
  let resolve!: (handled: boolean) => void;
  active.goBack.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const pending = nappletService.goBack();
  nappletService.openPanel('about');
  resolve(false);
  await pending;
  expect(active.close).not.toHaveBeenCalled();
  expect(nappletStore.getState().panel?.page).toBe('about');
});

it('grants only required domains when the user leaves optional capabilities disabled', async () => {
  const opening = nappletService.open(app);
  for (let i = 0; i < 20 && !nappletStore.getState().prompt; i++) await Promise.resolve();
  const prompt = nappletStore.getState().prompt!;
  expect(prompt.capabilities).toEqual({ required: ['shell', 'storage'], optional: ['identity'] });
  nappletService.answer(prompt.requestId, 'domains:[]');
  await opening;
  expect(JSON.parse(stored.get(key(scope, 'permissions', 'domains'))!)).toEqual(['shell', 'storage']);
});

it('revokes only the selected source rule and resets access independently from application data', async () => {
  const source = { accountPubkey: 'accountA', sourceId: 'app.example' };
  const scopeA = { operation: 'publish' as const, kind: 1, relays: [] };
  const scopeB = { operation: 'publish' as const, kind: 7, relays: [] };
  const rules = [scopeA, scopeB].map((scope) => ({ key: signingRuleKey(scope), scope, decision: 'allow' as const, duration: 'always' as const, createdAt: 1 }));
  signingRules.set(JSON.stringify(source), rules);
  signingRules.set(JSON.stringify({ ...source, accountPubkey: 'accountB' }), rules);
  await nappletService.revokeSigningRule(app, rules[0].key, 'accountA');
  expect(signingRules.get(JSON.stringify(source))).toEqual([rules[1]]);
  expect(signingRules.get(JSON.stringify({ ...source, accountPubkey: 'accountB' }))).toEqual(rules);
  stored.set(key(scope, 'permissions', 'domains'), '["shell"]');
  stored.set(key(scope, 'storage', 'progress'), 'preserve');
  await expect(nappletService.revokeSigningRule(app, rules[0].key, 'accountB')).rejects.toThrow('session-closed');
  await nappletService.revoke(app, 'accountA');
  expect(clearBrowserPermissions).toHaveBeenCalledWith(source);
  expect(stored.has(key(scope, 'permissions', 'domains'))).toBe(false);
  expect(signingRules.has(JSON.stringify(source))).toBe(false);
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

it('keeps app input blocked until the host sheet has finished exiting', async () => {
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


it('optimistically serializes desktop edits and persists the latest complete order', async () => {
  const items = [{ ...app, desktopPosition: 0 }, { ...app, key: 'second', desktopPosition: null }];
  nappletStore.setState({ installed: items, recent: items });
  let finish!: () => void;
  jest.mocked(saveDesktopOrder).mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  const first = nappletService.moveDesktop('second', 0, 'accountA');
  expect(nappletStore.getState().installed.find((entry) => entry.key === 'second')?.desktopPosition).toBe(0);
  const second = nappletService.moveDesktop('app', null, 'accountA');
  await Promise.resolve();
  expect(saveDesktopOrder).toHaveBeenCalledTimes(1);
  finish();
  await Promise.all([first, second]);
  expect(saveDesktopOrder).toHaveBeenNthCalledWith(1, 'accountA', ['second', 'app']);
  expect(saveDesktopOrder).toHaveBeenNthCalledWith(2, 'accountA', ['second']);
  expect(nappletStore.getState().installed.find((entry) => entry.key === 'app')?.desktopPosition).toBeNull();
});

it('restores persisted desktop state after a failed write and rejects a stale account', async () => {
  const persisted = [{ ...app, desktopPosition: 0 }];
  nappletStore.setState({ installed: persisted, recent: persisted });
  jest.mocked(installations).mockResolvedValue(persisted);
  jest.mocked(saveDesktopOrder).mockRejectedValueOnce(new Error('disk-full'));
  const edit = nappletService.moveDesktop('app', null, 'accountA');
  expect(nappletStore.getState().installed[0].desktopPosition).toBeNull();
  await expect(edit).rejects.toThrow('disk-full');
  expect(nappletStore.getState().installed[0].desktopPosition).toBe(0);
  await expect(nappletService.moveDesktop('app', 0, 'accountB')).rejects.toThrow('session-closed');
  expect(saveDesktopOrder).toHaveBeenCalledTimes(1);
});


it('removes recent usage optimistically while preserving the desktop and guards account scope', async () => {
  const items = [{ ...app, desktopPosition: 0, lastUsedAt: 100 }];
  nappletStore.setState({ installed: items, recent: items });
  const edit = nappletService.removeRecent('app', 'accountA');
  expect(nappletStore.getState().recent).toEqual([]);
  expect(nappletStore.getState().installed[0]).toMatchObject({ desktopPosition: 0, lastUsedAt: null });
  await edit;
  expect(clearRecent).toHaveBeenCalledWith('accountA', 'app');
  await expect(nappletService.removeRecent('app', 'accountB')).rejects.toThrow('session-closed');
});

it('restores recent usage after its persistence fails', async () => {
  const items = [{ ...app, desktopPosition: 0, lastUsedAt: 100 }];
  nappletStore.setState({ installed: items, recent: items });
  jest.mocked(installations).mockResolvedValue(items);
  jest.mocked(clearRecent).mockRejectedValueOnce(new Error('disk-full'));
  await expect(nappletService.removeRecent('app', 'accountA')).rejects.toThrow('disk-full');
  expect(nappletStore.getState().installed[0]).toMatchObject({ desktopPosition: 0, lastUsedAt: 100 });
  expect(nappletStore.getState().recent).toEqual(items);
});

it('uses explicit details-page consent only when that prepared run starts', async () => {
  const reviewed = ['shell', 'storage'];
  const runId = nappletService.prepareOpen(app, 'accountA', reviewed);
  reviewed.push('identity');
  expect(stored.size).toBe(0);
  expect(NappletRuntime).not.toHaveBeenCalled();
  nappletService.startPreparedOpen(runId);
  await settleLaunch();
  expect(nappletStore.getState().prompt).toBeNull();
  expect(NappletRuntime).toHaveBeenCalledTimes(1);
  expect(JSON.parse(stored.get(key(scope, 'permissions', 'domains'))!)).toEqual(['shell', 'storage']);
  expect(stored.has(key({ ...scope, accountPubkey: 'accountB' }, 'permissions', 'domains'))).toBe(false);
});

it('asks again if the reviewed set does not match the required permissions', async () => {
  const runId = nappletService.prepareOpen(app, 'accountA', ['shell']);
  nappletService.startPreparedOpen(runId);
  for (let i = 0; i < 30 && !nappletStore.getState().prompt; i++) await Promise.resolve();
  const request = nappletStore.getState().prompt!;
  expect(request.capabilities?.required).toEqual(['shell', 'storage']);
  expect(stored.size).toBe(0);
  nappletService.answer(request.requestId, false);
  await settleLaunch();
  expect(NappletRuntime).not.toHaveBeenCalled();
});

it('keeps capability grants across upgrades and asks only for newly required access', async () => {
  const runId = nappletService.prepareOpen(app, 'accountA', ['shell', 'storage']);
  nappletService.startPreparedOpen(runId);
  await settleLaunch();
  await nappletService.open({ ...app, hash: 'v2' });
  expect(nappletStore.getState().prompt).toBeNull();
  const work = nappletService.open({ ...app, hash: 'v3', required: ['storage', 'relay'] });
  for (let i = 0; i < 40 && !nappletStore.getState().prompt; i++) await Promise.resolve();
  const request = nappletStore.getState().prompt!;
  expect(request.capabilities?.required).toContain('relay');
  nappletService.answer(request.requestId, false);
  await expect(work).rejects.toThrow('permission-denied');
});

it('discards unstarted details-page consent when the account changes', async () => {
  const runId = nappletService.prepareOpen(app, 'accountA', ['shell', 'storage']);
  await nappletService.activate('accountB');
  nappletService.startPreparedOpen(runId);
  await settleLaunch();
  expect(stored.size).toBe(0);
  expect(NappletRuntime).not.toHaveBeenCalled();
});
