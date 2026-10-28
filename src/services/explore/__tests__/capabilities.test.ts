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

async function connectTarget(owner = account) {
  await messaging.connect({ instance: 'target-instance', accountPubkey: owner, sourceId: target.key,
    title: target.title, actions: ['edit'], domains: [], auxiliary: false });
}

beforeEach(() => {
  favorites = [target];
  life = new AbortController();
  confirm = jest.fn(async () => 'instance:target-instance');
  launch = jest.fn(async () => connectTarget());
  received = jest.fn();
  capabilities = new NappCapabilities(account, caller, {} as NappletNetwork, {
    signal: life.signal, send: jest.fn(async () => {}), confirm, configure: jest.fn(),
    applications: async () => favorites, launch,
  }, 'caller-instance');
});

afterEach(async () => {
  life.abort();
  await capabilities.stop();
  await messaging.disconnect('target-instance');
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
