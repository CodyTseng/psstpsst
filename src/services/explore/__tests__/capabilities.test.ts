import { finalizeEvent, generateSecretKey } from 'nostr-tools';
import { applicationEntryFromAddress, resolveApplicationReference } from '../application-reference';
import { readDefaultActionHandler, setDefaultHandler } from '../default-handlers';
import { NappCapabilities } from '../capabilities';
import { applicationMessaging } from '../messaging';
import type { ExploreEntry } from '../model';
import type { ApplicationNetwork } from '@/services/applications/network';

jest.mock('../default-handlers', () => ({ readDefaultActionHandler: jest.fn(async () => null), setDefaultHandler: jest.fn(async () => {}) }));

jest.mock('../application-reference', () => ({ applicationEntryFromAddress: jest.fn(), resolveApplicationReference: jest.fn() }));

let mockCatalogue: ExploreEntry[] = [];
jest.mock('../discovery', () => ({ getDiscoveryStore: () => ({ getState: () => ({ entries: mockCatalogue }) }) }));

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
  jest.clearAllMocks();
  warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.mocked(readDefaultActionHandler).mockResolvedValue(null);
  jest.mocked(setDefaultHandler).mockClear();
  jest.mocked(applicationEntryFromAddress).mockImplementation(value => value === target.key ? target : undefined);
  jest.mocked(resolveApplicationReference).mockImplementation(async (_account, reference) => reference.key === target.key ? target : null);
  favorites = [target];
  mockCatalogue = [];
  life = new AbortController();
  confirm = jest.fn(async () => 'instance:target-instance');
  launch = jest.fn(async () => connectTarget());
  received = jest.fn();
  applications = jest.fn(async () => favorites);
  capabilities = new NappCapabilities(account, caller, {} as ApplicationNetwork, {
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

it('offers a declared live handler without requiring My apps membership', async () => {
  await connectTarget();
  favorites = [];
  const detach = messaging.onMessage((instance, message) => {
    if (instance !== 'target-instance') return;
    received(message);
    void messaging.request(instance, { type: 'actionResult', requestId: message.requestId, result: 'done' });
  });
  try {
    await expect(capabilities.handle('action', ['edit', 'content'])).resolves.toBe('done');
    await expect(capabilities.handle('action', ['edit', 'content', { instance: 'target-instance' }])).resolves.toBe('done');
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ choices: [expect.objectContaining({ key: 'instance:target-instance' })] }), life.signal);
    expect(received).toHaveBeenCalledTimes(2);
    expect(launch).not.toHaveBeenCalled();
    expect(favorites).toEqual([]);
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

it.each(['selection', 'startup'])('rejects an endpoint closed during %s', async stage => {
  if (stage === 'selection') {
    await connectTarget();
    confirm.mockImplementation(async () => { favorites = []; await messaging.disconnect('target-instance'); return 'instance:target-instance'; });
  } else {
    confirm.mockResolvedValue('source:target');
    launch.mockImplementation(async () => { await connectTarget(); favorites = []; await messaging.disconnect('caller-instance'); });
  }
  await expect(capabilities.handle('action', ['edit', {}])).rejects.toThrow(stage === 'startup' ? 'session-closed' : 'handler-unavailable');
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

it.each(['instance-not-running', 'action-not-declared', 'mode-mismatch', 'action-not-registered'])('logs the action and exact handler rejection: %s', async reason => {
  if (reason !== 'instance-not-running') await connectTarget(account,
    reason === 'action-not-registered' ? ['profile'] : ['edit'], reason === 'mode-mismatch');
  if (reason === 'action-not-declared') favorites = [{ ...target, manifest: { ...target.manifest!, tags: [] } } as ExploreEntry];
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
  expect(warning).toHaveBeenCalledWith('[explore] Action handler unavailable', expect.objectContaining({ reason: 'action-not-declared' }));
});

it.each(['mode-mismatch', 'action-not-registered'])('still validates explicit self-target handlers: %s', async reason => {
  favorites = [];
  await capabilities.handle('registerAction', ['relay']);
  const name = reason === 'action-not-registered' ? 'edit' : 'relay';
  await expect(capabilities.handle('action', [name, {}, { instance: 'caller-instance', auxiliary: reason === 'mode-mismatch' }])).rejects.toThrow('permission-denied');
  expect(warning).toHaveBeenCalledWith('[explore] Action handler unavailable', expect.objectContaining({ reason }));
});

it('launches an explicitly selected compatible catalogue app without adding it to My apps', async () => {
  favorites = [];
  mockCatalogue = [target];
  confirm.mockResolvedValue('discovery:target');
  const detach = messaging.onMessage((instance, message) => {
    if (instance === 'target-instance') void messaging.request(instance, { type: 'actionResult', requestId: message.requestId, result: 'discovered' });
  });
  try {
    await expect(capabilities.handle('action', ['edit', {}])).resolves.toBe('discovered');
    expect(launch).toHaveBeenCalledWith(target);
    expect(favorites).toEqual([]);
  } finally { detach(); }
});

it.each(['missing', 'wrong-action', 'wrong-mode', 'explicit-instance'])('rejects an invalid catalogue selection: %s', async reason => {
  favorites = [];
  mockCatalogue = reason === 'missing' ? [] : [{ ...target, manifest: { tags: reason === 'wrong-action' ? [['action', 'profile']] :
    [['action', 'edit'], ...(reason === 'wrong-mode' ? [['mode', 'auxiliary']] : [])] } } as ExploreEntry];
  confirm.mockResolvedValue('discovery:target');
  await expect(capabilities.handle('action', ['edit', {}, reason === 'explicit-instance' ? { instance: 'target-instance' } : {}])).rejects.toThrow('permission-denied');
  expect(launch).not.toHaveBeenCalled();
});

it('remembers an explicit choice and reuses its live endpoint without another chooser', async () => {
  await connectTarget();
  confirm.mockResolvedValue('default:instance:target-instance');
  const detach = messaging.onMessage((instance, message) => {
    if (instance === 'target-instance') void messaging.request(instance, { type: 'actionResult', requestId: message.requestId, result: 'opened' });
  });
  try {
    await expect(capabilities.handle('action', ['edit', {}])).resolves.toBe('opened');
    expect(setDefaultHandler).toHaveBeenCalledWith(account, { kind: 'action', name: 'edit', auxiliary: false }, target);
    jest.mocked(readDefaultActionHandler).mockResolvedValue({ type: { kind: 'action', name: 'edit', auxiliary: false }, sourceId: target.key, title: target.title });
    confirm.mockClear();
    await expect(capabilities.handle('action', ['edit', {}])).resolves.toBe('opened');
    expect(confirm).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
  } finally { detach(); }
});

it('launches a saved default that is not running', async () => {
  jest.mocked(readDefaultActionHandler).mockResolvedValue({ type: { kind: 'action', name: 'edit', auxiliary: false }, sourceId: target.key, title: target.title });
  const detach = messaging.onMessage((instance, message) => {
    if (instance === 'target-instance') void messaging.request(instance, { type: 'actionResult', requestId: message.requestId, result: 'opened' });
  });
  try {
    await expect(capabilities.handle('action', ['edit', {}])).resolves.toBe('opened');
    expect(launch).toHaveBeenCalledWith(target);
    expect(confirm).not.toHaveBeenCalled();
  } finally { detach(); }
});

it('asks again when the saved default no longer supports the requested operation', async () => {
  favorites = [{ ...target, manifest: { tags: [['action', 'view']] } } as ExploreEntry];
  jest.mocked(readDefaultActionHandler).mockResolvedValue({ type: { kind: 'action', name: 'edit', auxiliary: false }, sourceId: target.key, title: target.title });
  confirm.mockResolvedValue(false);
  await expect(capabilities.handle('action', ['edit', {}])).rejects.toThrow('permission-denied');
  expect(confirm).toHaveBeenCalled();
  expect(launch).not.toHaveBeenCalled();
});

it('ignores saved preferences for an explicit live instance', async () => {
  await connectTarget();
  confirm.mockResolvedValue(false);
  jest.mocked(readDefaultActionHandler).mockClear();
  await expect(capabilities.handle('action', ['edit', {}, { instance: 'target-instance' }])).rejects.toThrow('permission-denied');
  expect(readDefaultActionHandler).not.toHaveBeenCalled();
  expect(confirm).toHaveBeenCalled();
});

it('does not remember cancellation or a one-time selection', async () => {
  confirm.mockResolvedValue(false);
  await expect(capabilities.handle('action', ['edit', {}])).rejects.toThrow('permission-denied');
  expect(setDefaultHandler).not.toHaveBeenCalled();
});


it.each([true, false])('revalidates a remembered catalogue reference before automatic dispatch (available=%s)', async available => {
  favorites = [];
  jest.mocked(readDefaultActionHandler).mockResolvedValue({ type: { kind: 'action', name: 'edit', auxiliary: false },
    sourceId: target.key, title: target.title, address: 'saved-address' });
  jest.mocked(applicationEntryFromAddress).mockReturnValue(target);
  jest.mocked(resolveApplicationReference).mockResolvedValue(available ? target : null);
  confirm.mockResolvedValue(false);
  const detach = messaging.onMessage((instance, message) => {
    if (instance === 'target-instance') void messaging.request(instance, { type: 'actionResult', requestId: message.requestId, result: 'opened' });
  });
  try {
    if (available) {
      await expect(capabilities.handle('action', ['edit', {}])).resolves.toBe('opened');
      expect(confirm).not.toHaveBeenCalled();
      expect(launch).toHaveBeenCalledWith(target);
    } else {
      await expect(capabilities.handle('action', ['edit', {}])).rejects.toThrow('permission-denied');
      expect(confirm).toHaveBeenCalled();
    }
    expect(resolveApplicationReference).toHaveBeenCalledWith(account, target, life.signal);
  } finally { detach(); }
});


it.each([true, false])('does not offer runtime-only registrations without declarations (favorite=%s)', async favorite => {
  const undeclared = { ...target, manifest: { ...target.manifest!, tags: [] } } as ExploreEntry;
  favorites = favorite ? [undeclared] : [];
  jest.mocked(resolveApplicationReference).mockResolvedValue(undeclared);
  await connectTarget();
  confirm.mockResolvedValue(false);
  await expect(capabilities.handle('action', ['edit', {}])).rejects.toThrow('permission-denied');
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ choices: [] }), life.signal);
  expect(setDefaultHandler).not.toHaveBeenCalled();
});

it('reuses a declared running non-library default without opening another chooser', async () => {
  favorites = [];
  await connectTarget();
  jest.mocked(readDefaultActionHandler).mockResolvedValue({ type: { kind: 'action', name: 'edit', auxiliary: false }, sourceId: target.key, title: target.title, address: target.address });
  const detach = messaging.onMessage((instance, message) => {
    if (instance === 'target-instance') void messaging.request(instance, { type: 'actionResult', requestId: message.requestId, result: 'opened' });
  });
  try {
    await expect(capabilities.handle('action', ['edit', {}])).resolves.toBe('opened');
    expect(confirm).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
  } finally { detach(); }
});


it('offers a saved application only once when its compatible instance is already running', async () => {
  await connectTarget();
  confirm.mockResolvedValue(false);
  await expect(capabilities.handle('action', ['edit', {}])).rejects.toThrow('permission-denied');
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ choices: [expect.objectContaining({ key: 'instance:target-instance' })] }), life.signal);
});

it('keeps a declared live handler available when it is removed from My apps during selection', async () => {
  await connectTarget();
  confirm.mockImplementation(async () => { favorites = []; return 'instance:target-instance'; });
  const detach = messaging.onMessage((instance, message) => {
    if (instance === 'target-instance') void messaging.request(instance, { type: 'actionResult', requestId: message.requestId, result: 'opened' });
  });
  try { await expect(capabilities.handle('action', ['edit', {}])).resolves.toBe('opened'); }
  finally { detach(); }
});

const brokenDefault = { ...target, key: 'broken', address: 'broken', title: 'Broken default' };
function preferBrokenDefault() {
  favorites = [brokenDefault, target];
  jest.mocked(readDefaultActionHandler).mockResolvedValue({ type: { kind: 'action', name: 'edit', auxiliary: false },
    sourceId: brokenDefault.key, title: brokenDefault.title, address: brokenDefault.address });
}

it.each([false, true])('offers another handler after automatic startup fails (remember replacement=%s)', async remember => {
  preferBrokenDefault();
  launch.mockImplementation(async app => {
    if (app.key === brokenDefault.key) throw new Error('applications.download_failed');
    await connectTarget();
  });
  confirm.mockResolvedValue(`${remember ? 'default:' : ''}source:target`);
  const detach = messaging.onMessage((instance, message) => {
    if (instance === 'target-instance') {
      received(message);
      void messaging.request(instance, { type: 'actionResult', requestId: message.requestId, result: 'opened' });
    }
  });
  try {
    const payload = { content: 'the original request' };
    await expect(capabilities.handle('action', ['edit', payload])).resolves.toBe('opened');
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ choices: expect.arrayContaining([
      expect.objectContaining({ key: 'source:target' }),
    ]) }), life.signal);
    expect(launch.mock.calls.map(([app]) => app.key)).toEqual(['broken', 'target']);
    expect(received).toHaveBeenCalledTimes(1);
    expect(received).toHaveBeenCalledWith(expect.objectContaining({ name: 'edit', payload }));
    expect(readDefaultActionHandler).toHaveBeenCalledTimes(1);
    if (remember) expect(setDefaultHandler).toHaveBeenCalledWith(account, { kind: 'action', name: 'edit', auxiliary: false }, target);
    else expect(setDefaultHandler).not.toHaveBeenCalled();
  } finally { detach(); }
});

it('restores selection when the default starts without registering the requested handler', async () => {
  jest.useFakeTimers();
  preferBrokenDefault();
  const restore = jest.fn(async () => { await messaging.disconnect('broken-instance'); });
  launch.mockImplementation(async app => {
    if (app.key === brokenDefault.key) {
      await messaging.connect({ instance: 'broken-instance', accountPubkey: account,
        sourceId: brokenDefault.key, title: brokenDefault.title, actions: ['profile'], domains: [] });
      return restore;
    }
    await connectTarget();
  });
  confirm.mockImplementation(async () => {
    expect(restore).toHaveBeenCalledTimes(1);
    return 'source:target';
  });
  const detach = messaging.onMessage((instance, message) => {
    if (instance === 'target-instance') void messaging.request(instance, { type: 'actionResult', requestId: message.requestId, result: 'opened' });
  });
  try {
    const pending = capabilities.handle('action', ['edit', {}]);
    await jest.advanceTimersByTimeAsync(0);
    expect(confirm).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(25000);
    await expect(pending).resolves.toBe('opened');
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(readDefaultActionHandler).toHaveBeenCalledTimes(1);
  } finally { detach(); await messaging.disconnect('broken-instance'); jest.useRealTimers(); }
});

it('does not restore selection when the requester cancels during automatic startup', async () => {
  preferBrokenDefault();
  launch.mockImplementation(async () => { life.abort(); throw new Error('startup-failed'); });
  await expect(capabilities.handle('action', ['edit', {}])).rejects.toMatchObject({ name: 'AbortError' });
  expect(confirm).not.toHaveBeenCalled();
});

it('does not restore selection when the requester cancels while waiting for registration', async () => {
  jest.useFakeTimers();
  preferBrokenDefault();
  launch.mockResolvedValue(undefined);
  try {
    const pending = expect(capabilities.handle('action', ['edit', {}])).rejects.toMatchObject({ name: 'AbortError' });
    await jest.advanceTimersByTimeAsync(0);
    life.abort();
    await jest.advanceTimersByTimeAsync(0);
    await pending;
    expect(confirm).not.toHaveBeenCalled();
  } finally { jest.useRealTimers(); }
});

it.each(['permission-denied', 'session-closed'])('preserves explicit refusal or session failure: %s', async reason => {
  preferBrokenDefault();
  launch.mockRejectedValue(new Error(reason));
  await expect(capabilities.handle('action', ['edit', {}])).rejects.toThrow(reason);
  expect(confirm).not.toHaveBeenCalled();
});

it('does not loop if the user explicitly retries the failed default', async () => {
  preferBrokenDefault();
  launch.mockRejectedValue(new Error('startup-failed'));
  confirm.mockResolvedValue('source:broken');
  await expect(capabilities.handle('action', ['edit', {}])).rejects.toThrow('startup-failed');
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(launch).toHaveBeenCalledTimes(2);
});

it('does not retry an action after invocation has reached the default handler', async () => {
  await connectTarget();
  jest.mocked(readDefaultActionHandler).mockResolvedValue({ type: { kind: 'action', name: 'edit', auxiliary: false }, sourceId: target.key, title: target.title });
  const detach = messaging.onMessage((instance, message) => {
    if (instance === 'target-instance') {
      received(message);
      void messaging.request(instance, { type: 'actionResult', requestId: message.requestId, error: 'handler-unavailable' });
    }
  });
  try {
    await expect(capabilities.handle('action', ['edit', {}])).rejects.toThrow('handler-unavailable');
    expect(confirm).not.toHaveBeenCalled();
    expect(received).toHaveBeenCalledTimes(1);
  } finally { detach(); }
});


it.each(['view:30023', 'view'].flatMap(requested => ['view', 'view:30023'].map(registered => ({ requested, registered }))))(
  'requires an exact article declaration for $requested with a $registered callback', async ({ requested, registered }) => {
  const reader = { ...target, manifest: { ...target.manifest!, tags: [['action', 'view:30023']] } };
  const generic = { ...target, key: 'generic', title: 'Generic viewer', manifest: { ...target.manifest!, tags: [['action', 'view']] } };
  favorites = [generic, reader];
  await connectTarget(account, [registered]);
  jest.mocked(readDefaultActionHandler).mockResolvedValue({ type: { kind: 'action', name: 'view:30023', auxiliary: false }, sourceId: generic.key, title: generic.title });
  await messaging.connect({ instance: 'generic-instance', accountPubkey: account, sourceId: generic.key,
    title: generic.title, actions: ['view'], domains: [] });
  const event = finalizeEvent({ kind: 30023, created_at: 1, tags: [['d', 'article']], content: 'Article' }, generateSecretKey());
  const detach = messaging.onMessage((instance, message) => {
    if (instance === 'target-instance' || instance === 'generic-instance') {
      received(instance, message);
      void messaging.request(instance, { type: 'actionResult', requestId: message.requestId, result: 'opened' });
    }
  });
  try {
    await expect(capabilities.handle('action', [requested, event])).resolves.toBe('opened');
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ choices: [expect.objectContaining({ key: 'instance:target-instance' })] }), life.signal);
    expect(received).toHaveBeenCalledWith('target-instance', expect.objectContaining({ name: registered, payload: event }));
    expect(launch).not.toHaveBeenCalled();
  } finally { detach(); await messaging.disconnect('generic-instance'); }
});


it('cancels a requester disconnected while waiting without warning or retrying selection', async () => {
  jest.useFakeTimers();
  preferBrokenDefault();
  launch.mockResolvedValue(undefined);
  try {
    const pending = expect(capabilities.handle('action', ['edit', {}])).rejects.toThrow('session-closed');
    await jest.advanceTimersByTimeAsync(0);
    await messaging.disconnect('caller-instance');
    await pending;
    expect(confirm).not.toHaveBeenCalled();
    expect(warning).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  } finally { jest.useRealTimers(); }
});

it('still reports a target closed during invocation without redispatching the action', async () => {
  await connectTarget();
  const detach = messaging.onMessage((instance, message) => {
    if (instance === 'target-instance' && message.type === 'action') void messaging.disconnect(instance);
  });
  try {
    await expect(capabilities.handle('action', ['edit', {}])).rejects.toThrow('endpoint-closed');
    expect(warning).toHaveBeenCalledWith('[explore] Action failed', expect.objectContaining({ error: 'endpoint-closed' }));
    expect(launch).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledTimes(1);
  } finally { detach(); }
});
