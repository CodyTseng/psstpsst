import { NappCapabilities } from '../capabilities';
import { applicationMessaging } from '../messaging';
import type { ExploreEntry } from '../model';
import type { NappletNetwork } from '@/services/napplet/network';

jest.mock('@/platform', () => ({ platform: { napplet: {} } }));
jest.mock('@/services/local-relay', () => ({ localRelay: {} }));
jest.mock('@/services/napplet/repository', () => ({ getData: jest.fn(), setData: jest.fn() }));

const account = 'a'.repeat(64);
const caller: ExploreEntry = { key: 'caller', address: 'caller', title: 'Caller', kind: 'napp',
  description: '', servers: [], required: [], desktopPosition: null, lastUsedAt: null };
const target = { ...caller, key: 'target', title: 'Target', desktopPosition: 0,
  manifest: { tags: [['action', 'edit']] } } as ExploreEntry;
const messaging = applicationMessaging();
let favorites: ExploreEntry[];
let life: AbortController;
let capabilities: NappCapabilities;
let confirm: jest.Mock;
let launch: jest.Mock;
let received: jest.Mock;
let applications: jest.Mock;
let warning: jest.SpyInstance;

async function connectTarget(owner = account, actions = ['edit'], auxiliary = false) {
  await messaging.connect({ instance: 'target-instance', accountPubkey: owner, sourceId: target.key,
    title: target.title, actions, domains: [], auxiliary });
}

beforeEach(() => {
  warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
  favorites = [target];
  life = new AbortController();
  confirm = jest.fn(async () => 'instance:target-instance');
  launch = jest.fn(async () => connectTarget());
  received = jest.fn();
  applications = jest.fn(async () => favorites);
  capabilities = new NappCapabilities(account, caller, {} as NappletNetwork, {
    signal: life.signal, send: jest.fn(async () => {}), confirm, configure: jest.fn(),
    applications, launch,
  }, 'caller-instance');
});

afterEach(async () => {
  life.abort();
  await capabilities.stop();
  await messaging.disconnect('target-instance');
  warning.mockRestore();
});

it('offers a live handler only while its application is a favorite, including explicit instance calls', async () => {
  await connectTarget();
  const detach = messaging.onMessage((instance, message) => {
    if (instance !== 'target-instance') return;
    received(message);
    void messaging.request(instance, { type: 'actionResult', requestId: message.requestId, result: 'done' });
  });
  try {
    await expect(capabilities.handle('action', ['edit', 'content'])).resolves.toBe('done');
    favorites = [];
    await expect(capabilities.handle('action', ['edit', 'content'])).rejects.toThrow('permission-denied');
    await expect(capabilities.handle('action', ['edit', 'content', { instance: 'target-instance' }])).rejects.toThrow('permission-denied');
    expect(received).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledTimes(3);
  } finally { detach(); }
});

it('launches a favorite that is not running and waits for its registered handler', async () => {
  confirm.mockResolvedValue('source:target');
  const detach = messaging.onMessage((instance, message) => {
    if (instance === 'target-instance') void messaging.request(instance, { type: 'actionResult', requestId: message.requestId, result: 'opened' });
  });
  try {
    await expect(capabilities.handle('action', ['edit', {}])).resolves.toBe('opened');
    expect(launch).toHaveBeenCalledWith(target);
  } finally { detach(); }
});

it.each(['selection', 'startup'])('rejects a favorite removed during %s', async stage => {
  if (stage === 'selection') {
    await connectTarget();
    confirm.mockImplementation(async () => { favorites = []; return 'instance:target-instance'; });
  } else {
    confirm.mockResolvedValue('source:target');
    launch.mockImplementation(async () => { await connectTarget(); favorites = []; });
  }
  await expect(capabilities.handle('action', ['edit', {}])).rejects.toThrow('handler-unavailable');
});

it('does not expose another account live instance even when the same application is a favorite', async () => {
  await connectTarget('b'.repeat(64));
  await expect(capabilities.handle('action', ['edit', {}, { instance: 'target-instance' }])).rejects.toThrow('permission-denied');
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ choices: [], applicationSelection: expect.objectContaining({ unavailable: 'instance' }) }), life.signal);
});

it('offers discovery with the exact requested action and mode when no favorite can handle it', async () => {
  favorites = [];
  confirm.mockResolvedValue(false);
  await expect(capabilities.handle('action', ['edit', {}, { auxiliary: true }])).rejects.toThrow('permission-denied');
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ accountPubkey: account, choices: [],
    applicationSelection: { requester: 'Caller', content: 'content', discovery: { name: 'edit', auxiliary: true } } }), life.signal);
  expect(launch).not.toHaveBeenCalled();
});

it.each(['instance-not-running', 'app-not-added', 'mode-mismatch', 'action-not-registered'])('logs the action and exact handler rejection: %s', async reason => {
  if (reason !== 'instance-not-running') await connectTarget(account,
    reason === 'action-not-registered' ? ['profile'] : ['edit'], reason === 'mode-mismatch');
  if (reason === 'app-not-added') favorites = [];
  const payload = { content: 'private content' };
  await expect(capabilities.handle('action', ['edit', payload, { instance: 'target-instance' }])).rejects.toThrow('permission-denied');
  expect(warning).toHaveBeenCalledWith('[explore] Action handler unavailable', expect.objectContaining({
    requester: 'Caller', action: 'edit', requesterInstance: 'caller-instance', targetInstance: 'target-instance', reason,
  }));
  expect(JSON.stringify(warning.mock.calls)).not.toContain('private content');
});

it('delivers an explicit self-target without My apps membership or a chooser', async () => {
  favorites = [];
  await capabilities.handle('registerAction', ['relay']);
  const detach = messaging.onMessage((instance, message) => {
    if (instance !== 'caller-instance' || message.type !== 'action') return;
    received(message);
    void messaging.request(instance, { type: 'actionResult', requestId: message.requestId, result: 'self-opened' });
  });
  try {
    await expect(capabilities.handle('action', ['relay', 'wss://relay.example/', { instance: 'caller-instance' }])).resolves.toBe('self-opened');
    expect(received).toHaveBeenCalledWith(expect.objectContaining({ name: 'relay', payload: 'wss://relay.example/' }));
    expect(applications).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
  } finally { detach(); }
});

it('does not extend the self-target exception to another instance of the same app', async () => {
  favorites = [];
  await messaging.connect({ instance: 'target-instance', accountPubkey: account, sourceId: caller.key,
    title: caller.title, actions: ['relay'], domains: [] });
  await expect(capabilities.handle('action', ['relay', {}, { instance: 'target-instance' }])).rejects.toThrow('permission-denied');
  expect(warning).toHaveBeenCalledWith('[explore] Action handler unavailable', expect.objectContaining({ reason: 'app-not-added' }));
});

it.each(['mode-mismatch', 'action-not-registered'])('still validates explicit self-target handlers: %s', async reason => {
  favorites = [];
  await capabilities.handle('registerAction', ['relay']);
  const name = reason === 'action-not-registered' ? 'edit' : 'relay';
  await expect(capabilities.handle('action', [name, {}, { instance: 'caller-instance', auxiliary: reason === 'mode-mismatch' }])).rejects.toThrow('permission-denied');
  expect(warning).toHaveBeenCalledWith('[explore] Action handler unavailable', expect.objectContaining({ reason }));
});
