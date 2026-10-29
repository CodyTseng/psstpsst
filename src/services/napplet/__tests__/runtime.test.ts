import { rules as sharedRules, activity as sharedActivity } from '@/services/signing/testing/memory-repository';
import type { Event, EventTemplate } from 'nostr-tools';
import type { ManagedSubscribeOptions } from '@/services/relay/managed-relay-pool';
import { NappletRuntime, type RuntimeOptions } from '../runtime';
import { NAP_DOMAINS, type NappletRelease } from '../protocol';
import { platform } from '@/platform';
import { NAPPLET_FRAME_READY_MESSAGE } from '@/platform/ports/napplet';
import { getData, setData } from '../repository';
import { NappletNetwork } from '../network';
import { invalidateSigning } from '@/services/signing/changes';
import { appSigningScope } from '../signing-permissions';

jest.mock('@/services/explore/browser-permission-store', () => ({ readBrowserPermissions: jest.fn(async () => []), saveBrowserPermissions: jest.fn(async () => {}) }));
jest.mock('@/services/signing/repository', () => jest.requireActual('../../signing/testing/memory-repository').memoryRepository);
jest.mock('@/i18n/core', () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock('@/services/files/media-server.service', () => ({ loadAccountMediaServers: jest.fn(async () => ['https://media.example/']) }));
jest.mock('@/platform', () => ({
  platform: {
    napplet: {
      open: jest.fn(async () => 'container'),
      close: jest.fn(async () => {}),
      goBack: jest.fn(async () => true),
      send: jest.fn(async () => {}),
      fetchResource: jest.fn(async (url: string) => {
        if (url.includes('bad.example')) throw new Error('network-error');
        return new TextEncoder().encode('{}');
      }),
      addMessageListener: jest.fn(() => () => {}),
    },
    urlOpener: { openExternalUrl: jest.fn(async () => true) },
    deviceCrypto: { sha256Hex: jest.fn(async () => 'c'.repeat(64)) },
    fileSystem: {
      cacheDirectoryUri: jest.fn(async () => 'file:///cache/'), makeDirectory: jest.fn(async () => {}),
      openWriteHandle: jest.fn(async () => ({ writeBytes: async () => {}, close: async () => {} })),
      uploadFile: jest.fn(async () => ({ status: 200, body: JSON.stringify({ url: `https://media.example/${'c'.repeat(64)}`, sha256: 'c'.repeat(64), size: 3 }) })),
      delete: jest.fn(async () => {}),
    },
  },
}));
jest.mock('../artifacts', () => ({ fetchBlob: jest.fn() }));
jest.mock('../repository', () => ({
  getData: jest.fn(async () => null),
  dataEntries: jest.fn(async () => new Map()),
  setData: jest.fn(async () => {}),
  dataKeys: jest.fn(async () => []),
}));
jest.mock('../network', () => ({
  NappletNetwork: jest.fn().mockImplementation(() => ({
    destroy: jest.fn(),
    sign: jest.fn(),
    publish: jest.fn(),
    getSigner: jest.fn(),
    pool: { subscribe: jest.fn(() => () => {}) },
  })),
  relayUrls: () => ['wss://relay.example/'],
}));

const release = {
  eventKey: `35129:${'b'.repeat(64)}:app`,
  title: 'Fixture',
  hash: 'a'.repeat(64),
  event: {},
  required: [],
  optional: [],
  servers: [],
  intents: [],
} as unknown as NappletRelease;
function options(accountPubkey = 'accountA'): RuntimeOptions {
  return {
    accountPubkey,
    release,
    html: '',
    domains: [...NAP_DOMAINS],
    theme: () => ({ colors: { background: '#fff', text: '#000', primary: '#00f' } }),
    confirm: jest.fn(async () => 'allow'),
    configure: jest.fn(),
    handlers: jest.fn(async () => []),
    invoke: jest.fn(async () => {}),
  };
}
const messages = () =>
  jest.mocked(platform.napplet.send).mock.calls.map(([, raw]) => JSON.parse(raw));

test('drains a large historical backlog in order, accepts new events and releases queued events on close', async () => {
  jest.useFakeTimers();
  const runtime = new NappletRuntime(options()), stop = jest.fn();
  let subscription!: ManagedSubscribeOptions;
  runtime.network.subscribe = jest.fn(input => { subscription=input;return stop; });
  await runtime.open();
  try {
    await runtime.receive(JSON.stringify({type:'relay.subscribe',id:'subscribe-history',subId:'history',relay:'wss://relay.example/',filters:{kinds:[1]}}));
    expect(subscription).toBeDefined();
    const emit = (index: number) => subscription.onEvent({id:String(index),kind:1,pubkey:'a'.repeat(64),created_at:index,content:'note',tags:[],sig:''} as Event,'wss://relay.example/');
    for (let i=0;i<10000;i++) emit(i);
    subscription.onEose?.();
    await jest.advanceTimersByTimeAsync(16*100);
    const partial=messages().filter(message=>message.type==='relay.event');
    expect(partial.length).toBeGreaterThan(0);expect(partial.length).toBeLessThan(10000);
    for (let i=10000;i<10010;i++) emit(i);
    await jest.runAllTimersAsync();
    const delivered=messages().filter(message=>message.type==='relay.event'||message.type==='relay.eose');
    expect(delivered.filter(message=>message.type==='relay.event').map(message=>message.result.event.id)).toEqual(Array.from({length:10010},(_,i)=>String(i)));
    expect(delivered[10000].type).toBe('relay.eose');
    for (let i=10010;i<10020;i++) emit(i);
    await runtime.receive(JSON.stringify({type:'relay.close',id:'close-history',subId:'history'}));
    await jest.runAllTimersAsync();
    expect(messages().filter(message=>message.type==='relay.event')).toHaveLength(10010);
    expect(stop).toHaveBeenCalledTimes(1);
  } finally { await runtime.close();jest.useRealTimers(); }
});
beforeEach(() => {
  jest.clearAllMocks(); sharedRules.clear(); sharedActivity.clear();
});

test('NIP-07 works without declared domains and signs without publishing', async () => {
  const config = { ...options(), domains: ['shell'] };
  const runtime = new NappletRuntime(config);
  await runtime.open();
  try {
    await runtime.receive(JSON.stringify({ type: 'signer.getPublicKey', id: 'key' }));
    expect(messages().at(-1)).toMatchObject({ type: 'signer.getPublicKey.result', result: 'accountA' });
    expect(config.confirm).toHaveBeenCalledTimes(1);
    const event = { kind: 1, content: 'note', tags: [], created_at: 1 };
    jest.mocked(runtime.network.sign).mockResolvedValue({ ...event, sig: 'signature' } as any);
    await runtime.receive(JSON.stringify({ type: 'signer.signEvent', id: 'sign', event }));
    expect(messages().at(-1)).toMatchObject({ type: 'signer.signEvent.result', result: { sig: 'signature' } });
    expect(jest.mocked(config.confirm).mock.calls.at(-1)![0].signing?.operation).toBe('sign');
    expect(runtime.network.publish).not.toHaveBeenCalled();
  } finally { await runtime.close(); }
});

test.each(['signer.signEvent', 'outbox.publish'])('%s preserves large valid events and future timestamps', async type => {
  const config = options();
  const runtime = new NappletRuntime(config);
  const network = jest.mocked(NappletNetwork).mock.results.at(-1)!.value;
  const event = { kind: 3, created_at: Math.floor(Date.now() / 1000) + 365 * 86400,
    content: 'x'.repeat(70000), tags: [
      ...Array.from({ length: 1000 }, (_, index) => ['p', index.toString(16).padStart(64, '0')]),
      ['custom', ...Array.from({ length: 32 }, () => 'x'.repeat(5000))],
    ] };
  jest.mocked(network.sign).mockResolvedValue({ ...event, id: 'event', sig: 'signature' });
  jest.mocked(network.publish).mockResolvedValue({ 'wss://relay.example/': true });
  await runtime.open();
  try {
    await runtime.receive(JSON.stringify({ type, id: 'large-event', event,
      options: { toOutbox: false, relays: ['wss://relay.example/'] } }));
    expect(config.confirm).toHaveBeenCalled();
    expect(network.sign).toHaveBeenCalledWith(event);
    expect(messages().at(-1)?.error).toBeUndefined();
  } finally { await runtime.close(); }
});

test('NIP-07 refuses account access and invalid events before calling the signer', async () => {
  const config = { ...options(), domains: ['shell'] };
  jest.mocked(config.confirm).mockResolvedValue(false);
  const runtime = new NappletRuntime(config);
  await runtime.open();
  try {
    await runtime.receive(JSON.stringify({ type: 'signer.getPublicKey', id: 'key' }));
    expect(messages().at(-1)?.error).toBe('permission-denied');
    await runtime.receive(JSON.stringify({ type: 'signer.signEvent', id: 'sign', event: { kind: 1 } }));
    expect(messages().at(-1)?.error).toBe('invalid-event');
    expect(runtime.network.sign).not.toHaveBeenCalled();
  } finally { await runtime.close(); }
});

test.each(['close', 'revoke'])('discards a pending NIP-07 signature after %s', async (action) => {
  const runtime = new NappletRuntime({ ...options(), domains: ['shell'] });
  await runtime.open();
  let finish!: (value: any) => void;
  jest.mocked(runtime.network.sign).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const event = { kind: 1, content: 'note', tags: [], created_at: 1 };
  const request = runtime.receive(JSON.stringify({ type: 'signer.signEvent', id: 'sign', event }));
  try {
    for (let i = 0; i < 20 && !finish; i++) await new Promise(resolve => setTimeout(resolve, 0));
    expect(finish).toBeDefined();
    if (action === 'close') await runtime.close();
    else invalidateSigning(appSigningScope(runtime.scope));
    finish({ ...event, sig: 'late' });
    await request;
    expect(messages().some(message => message.result?.sig === 'late')).toBe(false);
    if (action === 'revoke') expect(messages().at(-1)?.error).toBe('permission-revoked');
  } finally { await runtime.close(); }
});

test('reports the trusted first frame once and ignores it after endpoint closure', async () => {
  const config = options();
  config.presented = jest.fn();
  const runtime = new NappletRuntime(config);
  await runtime.open();
  await runtime.receive(NAPPLET_FRAME_READY_MESSAGE);
  await runtime.receive(NAPPLET_FRAME_READY_MESSAGE);
  expect(config.presented).toHaveBeenCalledTimes(1);
  await runtime.close();
  await runtime.receive(NAPPLET_FRAME_READY_MESSAGE);
  expect(config.presented).toHaveBeenCalledTimes(1);
});

test('advertises the host upload rail only to an endpoint granted the upload domain', async () => {
  const runtime = new NappletRuntime(options());
  await runtime.open();
  try {
    await runtime.receive(JSON.stringify({ type: 'upload.info', id: 'info' }));
    expect(messages().at(-1)).toMatchObject({ type: 'upload.info.result', info: { rails: [{ rail: 'blossom', enabled: true }, { rail: 'nip96', enabled: false }] } });
    expect(messages().at(-1)?.info).not.toHaveProperty('maxBytes');
  } finally { await runtime.close(); }
  jest.mocked(platform.napplet.send).mockClear();
  const restricted = new NappletRuntime({ ...options(), domains: ['shell'] });
  await restricted.open();
  try {
    await restricted.receive(JSON.stringify({ type: 'upload.info', id: 'hidden' }));
    expect(messages().at(-1)).toMatchObject({ type: 'upload.info.result', error: 'permission-denied' });
  } finally { await restricted.close(); }
});

test.each([-1, 65536, 1.5])('rejects malformed publication kind %s', async (kind) => {
  const runtime = new NappletRuntime(options());
  await runtime.open();
  try {
    await runtime.receive(JSON.stringify({ type: 'outbox.publish', id: 'auth-token', event: { kind, content: '', tags: [] } }));
    expect(messages().at(-1)).toMatchObject({ type: 'outbox.publish.result', error: 'publication-blocked' });
    expect(runtime.network.sign).not.toHaveBeenCalled();
  } finally { await runtime.close(); }
});

test('updates the host canvas even when the app has not requested theme access', async () => {
  const config = options();
  config.domains = ['shell'];
  const runtime = new NappletRuntime(config);
  await runtime.open();
  try {
    runtime.updateTheme();
    expect(messages()).toContainEqual({ type: 'theme.changed', theme: config.theme() });
    expect(jest.mocked(platform.napplet.open).mock.calls.at(-1)![0]).toContain('background-color:#fff');
  } finally {
    await runtime.close();
  }
});

test('returns the container history result and rejects navigation after closing', async () => {
  const runtime = new NappletRuntime(options());
  await runtime.open();
  expect(await runtime.goBack()).toBe(true);
  expect(platform.napplet.goBack).toHaveBeenCalledWith('container');
  jest.mocked(platform.napplet.goBack).mockResolvedValueOnce(false);
  expect(await runtime.goBack()).toBe(false);
  await runtime.close();
  await expect(runtime.goBack()).rejects.toThrow();
  expect(platform.napplet.goBack).toHaveBeenCalledTimes(2);
});

test('storage operations always use the endpoint account and application identity', async () => {
  const first = new NappletRuntime(options('accountA'));
  const second = new NappletRuntime(options('accountB'));
  try {
    await first.open();
    await second.open();
    await first.receive(
      JSON.stringify({
        type: 'storage.set',
        id: '1',
        key: 'state',
        value: 'A',
        accountPubkey: 'accountB',
        artifactHash: 'spoofed',
      }),
    );
    await second.receive(JSON.stringify({ type: 'storage.get', id: '2', key: 'state' }));
    expect(setData).toHaveBeenCalledWith(
      { accountPubkey: 'accountA', appKey: release.eventKey },
      'storage',
      'state',
      'A',
    );
    expect(getData).toHaveBeenCalledWith(
      { accountPubkey: 'accountB', appKey: release.eventKey },
      'storage',
      'state',
    );
  } finally {
    await first.close();
    await second.close();
  }
});
test('closing during a permission prompt prevents external actions and late replies', async () => {
  let resolve!: (result: string) => void;
  const config = options();
  config.confirm = () =>
    new Promise((done) => {
      resolve = done;
    });
  const runtime = new NappletRuntime(config);
  await runtime.open();
  const pending = runtime.receive(
    JSON.stringify({ type: 'link.open', id: 'link', url: 'https://example.com/' }),
  );
  await runtime.close();
  resolve('allow');
  await pending;
  expect(platform.urlOpener.openExternalUrl).not.toHaveBeenCalled();
  expect(messages()).toEqual([]);
});
test('an intent target removed from favorites during selection is not invoked or saved as default', async () => {
  const config = options();
  const target = { ...release, eventKey: 'target', intents: [{ convention: 'napplet:profile/open', params: [] }] };
  let favorites = [target];
  config.handlers = async () => favorites;
  config.confirm = async () => { favorites = []; return 'default:target'; };
  const runtime = new NappletRuntime(config);
  await runtime.open();
  try {
    await runtime.receive(JSON.stringify({ type: 'intent.invoke', id: 'removed', request: { convention: 'napplet:profile/open' } }));
    expect(messages().at(-1)).toMatchObject({ type: 'intent.invoke.result', result: { ok: false, error: 'handler-unavailable' } });
    expect(config.invoke).not.toHaveBeenCalled();
    expect(setData).not.toHaveBeenCalledWith(expect.anything(), 'defaults', expect.anything(), expect.anything());
  } finally { await runtime.close(); }
});

test('a saved intent default cannot restore a removed favorite', async () => {
  const config = options();
  const runtime = new NappletRuntime(config);
  await runtime.open();
  jest.mocked(getData).mockImplementation(async (_scope, bucket) => bucket === 'defaults' ? 'target' : null);
  try {
    await runtime.receive(JSON.stringify({ type: 'intent.invoke', id: 'removed-default', request: { convention: 'napplet:profile/open' } }));
    expect(messages().at(-1)).toMatchObject({ type: 'intent.invoke.result', result: { ok: false, error: 'handler-unavailable' } });
    expect(config.confirm).not.toHaveBeenCalled();
    expect(config.invoke).not.toHaveBeenCalled();
  } finally { await runtime.close(); jest.mocked(getData).mockResolvedValue(null); }
});

test('the pinned shim intent request and delivery envelopes are preserved', async () => {
  const config = options();
  const target = {
    ...release,
    eventKey: 'target',
    intents: [{ convention: 'napplet:profile/open', params: ['pubkey'] }],
  };
  config.handlers = async () => [target];
  config.confirm = async () => 'target';
  const runtime = new NappletRuntime(config);
  await runtime.open();
  try {
    await runtime.receive(
      JSON.stringify({
        type: 'intent.invoke',
        id: 'invoke',
        request: {
          convention: 'napplet:profile/open',
          archetype: 'profile',
          action: 'open',
          payload: { pubkey: 'peer' },
        },
      }),
    );
    expect(config.invoke).toHaveBeenCalledWith(
      target,
      expect.objectContaining({ convention: 'napplet:profile/open', payload: { pubkey: 'peer' } }),
    );
    expect(messages()).toContainEqual(
      expect.objectContaining({
        type: 'intent.invoke.result',
        result: {
          ok: true,
          convention: 'napplet:profile/open',
          archetype: 'profile',
          action: 'open',
          handler: 'target',
        },
      }),
    );
    runtime.setDelivery({ id: 'delivery', payload: 'retained' });
    await runtime.receive(JSON.stringify({ type: 'shell.ready' }));
    expect(messages()).toContainEqual({
      type: 'intent.deliver',
      delivery: { id: 'delivery', payload: 'retained' },
    });
  } finally {
    await runtime.close();
  }
});
test('undeclared domains and reply-shaped messages cannot invoke a handler', async () => {
  const config = options();
  config.domains = ['shell'];
  const runtime = new NappletRuntime(config);
  await runtime.open();
  try {
    await runtime.receive(JSON.stringify({ type: 'storage.set', id: '1', key: 'a', value: 'b' }));
    await runtime.receive(
      JSON.stringify({ type: 'identity.getPublicKey.result', id: '2', pubkey: 'spoof' }),
    );
    expect(setData).not.toHaveBeenCalled();
    expect(messages()).toEqual([{ type: 'storage.set.result', id: '1', ok: false, error: 'permission-denied' }]);
  } finally {
    await runtime.close();
  }
  expect(NappletNetwork).toHaveBeenCalledWith('accountA');
});

test.each([
  { kind: 30000, tags: [['d', 'psstpsst-contacts']] },
  { kind: 30078, tags: [['d', 'psstpsst-saved-groups']] },
  { kind: 10007, tags: [] },
])('account configuration publication reaches user approval: $kind', async (event) => {
  const config = options();
  config.confirm = jest.fn(async () => false);
  const runtime = new NappletRuntime(config);
  runtime.network.routes = jest.fn(async () => ['wss://relay.example/']);
  await runtime.open();
  try {
    await runtime.receive(
      JSON.stringify({
        type: 'relay.publish',
        id: 'write',
        event: { ...event, content: 'replacement' },
      }),
    );
    expect(messages()).toContainEqual({
      type: 'relay.publish.result',
      id: 'write',
      ok: false,
      error: 'permission-denied',
    });
    expect(config.confirm).toHaveBeenCalledWith(expect.objectContaining({ signing: expect.objectContaining({ kind: event.kind }) }), expect.any(AbortSignal));
  } finally {
    await runtime.close();
  }
});

test('intent availability exposes the pinned candidate schema', async () => {
  const config = options();
  config.handlers = async () => [
    { ...release, intents: [{ convention: 'napplet:profile/open', params: ['pubkey'] }] },
  ];
  const runtime = new NappletRuntime(config);
  await runtime.open();
  try {
    await runtime.receive(
      JSON.stringify({ type: 'intent.available', id: 'available', archetype: 'profile' }),
    );
    expect(messages()).toContainEqual({
      type: 'intent.available.result',
      id: 'available',
      availability: {
        archetype: 'profile',
        available: true,
        hasDefault: false,
        candidates: [
          {
            id: release.eventKey,
            title: release.title,
            actions: ['open'],
            conventions: ['napplet:profile/open'],
            contracts: [{ convention: 'napplet:profile/open', params: ['pubkey'] }],
            isDefault: false,
          },
        ],
      },
    });
  } finally {
    await runtime.close();
  }
});

test('bulk resources accept pinned SDK requests and retain successful siblings', async () => {
  const runtime = new NappletRuntime(options());
  await runtime.open();
  try {
    await runtime.receive(
      JSON.stringify({
        type: 'resource.bytesMany',
        id: 'bulk',
        requests: [{ url: 'https://good.example/' }, { url: 'https://bad.example/' }],
      }),
    );
    expect(messages()).toContainEqual({
      type: 'resource.bytesMany.result',
      id: 'bulk',
      items: [
        {
          url: 'https://good.example/',
          ok: true,
          mime: 'application/json',
          blob: { __nappletBlob: 'e30=', mime: 'application/json' },
        },
        { url: 'https://bad.example/', ok: false, error: 'network-error' },
      ],
    });
  } finally {
    await runtime.close();
  }
});

test('publishing honors remembered scope and re-prompts when the application record changes', async () => {
  const config = options();
  config.confirm = jest.fn(async () => 'allow-session');
  const runtime = new NappletRuntime(config);
  const network = runtime.network;
  network.routes = jest.fn(async () => ['wss://relay.example/']);
  jest.mocked(network.sign).mockResolvedValue({ id: 'signed' } as never);
  jest.mocked(network.publish).mockResolvedValue({ 'wss://relay.example/': true });
  await runtime.open();
  try {
    for (const [id, record] of [['1', 'progress'], ['2', 'progress'], ['3', 'score']]) {
      await runtime.receive(JSON.stringify({ type: 'outbox.publish', id,
        event: { kind: 30078, content: '{}', tags: [['d', record]] } }));
    }
    expect(config.confirm).toHaveBeenCalledTimes(2);
    expect(network.sign).toHaveBeenCalledTimes(3);
    expect(network.publish).toHaveBeenCalledTimes(3);
  } finally { await runtime.close(); }
});

test('closing while a signing request is visible prevents signing and publication', async () => {
  let resolve!: (answer: string) => void;
  const config = options();
  config.confirm = jest.fn(() => new Promise<string>((done) => { resolve = done; }));
  const runtime = new NappletRuntime(config);
  runtime.network.routes = jest.fn(async () => ['wss://relay.example/']);
  await runtime.open();
  const pending = runtime.receive(JSON.stringify({ type: 'relay.publish', id: 'sign',
    event: { kind: 1, content: 'Publish me', tags: [] } }));
  while (!resolve) await Promise.resolve();
  await runtime.close();
  resolve('allow-always');
  await pending;
  expect(runtime.network.sign).not.toHaveBeenCalled();
  expect(runtime.network.publish).not.toHaveBeenCalled();
  expect(messages()).toEqual([]);
});

test('approved remote signatures remain usable after a slow signer returns', async () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
  const runtime = new NappletRuntime(options());
  runtime.network.routes = jest.fn(async () => ['wss://relay.example/']);
  jest.mocked(runtime.network.sign).mockImplementation(async () => {
    now.mockReturnValue(31000);
    return { id: 'late-signature' } as never;
  });
  jest.mocked(runtime.network.publish).mockResolvedValue({ 'wss://relay.example/': true });
  try {
    await runtime.open();
    await runtime.receive(JSON.stringify({ type: 'outbox.publish', id: 'late',
      event: { kind: 1, content: 'Expired', tags: [] } }));
    expect(runtime.network.publish).toHaveBeenCalledTimes(1);
    expect(messages()).toContainEqual(expect.objectContaining({ id: 'late', ok: true }));
  } finally { await runtime.close(); now.mockRestore(); }
});

test('queueing longer than the routing budget does not invalidate fresh displayed consent', async () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
  const config = options();
  config.confirm = jest.fn(async () => { now.mockReturnValue(61000); return 'allow'; });
  const runtime = new NappletRuntime(config);
  runtime.network.routes = jest.fn(async () => ['wss://relay.example/']);
  jest.mocked(runtime.network.sign).mockResolvedValue({ id: 'approved' } as never);
  jest.mocked(runtime.network.publish).mockResolvedValue({ 'wss://relay.example/': true });
  try {
    await runtime.open();
    await runtime.receive(JSON.stringify({ type: 'outbox.publish', id: 'queued',
      event: { kind: 1, content: 'Queued publication', tags: [] } }));
    expect(runtime.network.publish).toHaveBeenCalledTimes(1);
    expect(messages()).toContainEqual(expect.objectContaining({ id: 'queued', ok: true }));
  } finally { await runtime.close(); now.mockRestore(); }
});

test('revoking permission discards a signature already being computed', async () => {
  const config = options(); config.confirm = jest.fn(async () => 'allow-always');
  const runtime = new NappletRuntime(config);
  runtime.network.routes = jest.fn(async () => ['wss://relay.example/']);
  let finish!: (event: never) => void;
  jest.mocked(runtime.network.sign).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  try {
    await runtime.open();
    const pending = runtime.receive(JSON.stringify({ type: 'outbox.publish', id: 'revoked',
      event: { kind: 1, content: 'Pending signature', tags: [] } }));
    while (!finish) await Promise.resolve();
    const rule = (await runtime.signingPermissions.snapshot()).rules[0];
    await runtime.signingPermissions.revoke(rule.key);
    finish({ id: 'late' } as never);
    await pending;
    expect(runtime.network.publish).not.toHaveBeenCalled();
    expect(messages()).toContainEqual(expect.objectContaining({ id: 'revoked', error: 'permission-denied' }));
  } finally { await runtime.close(); }
});

async function transferFile(runtime: NappletRuntime, id: string) {
  await runtime.receive(JSON.stringify({ type: 'upload.transfer.start', id, seq: -1, size: 3,
    request: { filename: 'report.txt', mimeType: 'text/plain' } }));
  await runtime.receive(JSON.stringify({ type: 'upload.transfer.chunk', id, seq: 0, data: 'AQID' }));
  await runtime.receive(JSON.stringify({ type: 'upload.transfer.end', id, seq: 1 }));
}

it.each(['pending requests', 'call budget'])('accepts upload starts beyond the former %s limit', async limit => {
  const config = options();
  let releaseHandlers!: (value: NappletRelease[]) => void;
  const held = new Promise<NappletRelease[]>(resolve => { releaseHandlers = resolve; });
  jest.mocked(config.handlers).mockImplementation(() => held);
  const runtime = new NappletRuntime(config);
  const pending: Promise<void>[] = [];
  await runtime.open();
  try {
    if (limit === 'pending requests') {
      for (let index = 0; index < 16; index++)
        pending.push(runtime.receive(JSON.stringify({ type: 'intent.handlers', id: `held-${index}` })));
    } else {
      for (let index = 0; index < 240; index++)
        await runtime.receive(JSON.stringify({ type: 'theme.get', id: `call-${index}` }));
    }
    await runtime.receive(JSON.stringify({ type: 'upload.transfer.start', id: 'limited-upload', seq: -1,
      size: 3, request: { filename: 'report.txt', mimeType: 'text/plain' } }));
    expect(messages().filter(message => message.id === 'limited-upload')).toEqual([
      { type: 'psst.upload.ack', id: 'limited-upload', seq: -1 },
    ]);
    expect(config.confirm).not.toHaveBeenCalled();
    expect(platform.fileSystem.uploadFile).not.toHaveBeenCalled();
  } finally {
    releaseHandlers([]);
    await Promise.all(pending);
    await runtime.close();
  }
});

it('asks for each file as app consent and signs Blossom authentication only after approval', async () => {
  const config = options();
  const runtime = new NappletRuntime(config);
  const network = jest.mocked(NappletNetwork).mock.results.at(-1)!.value;
  jest.mocked(network.sign).mockImplementation(async (template: EventTemplate) => ({ ...template, pubkey: 'a'.repeat(64), id: 'b'.repeat(64), sig: 'd'.repeat(128) }));
  await runtime.open();
  await transferFile(runtime, 'file-one');
  for (let i = 0; i < 100 && !jest.mocked(platform.fileSystem.uploadFile).mock.calls.length; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  expect(config.confirm).toHaveBeenCalledWith(expect.objectContaining({ upload: expect.objectContaining({ filename: 'report.txt', size: 3 }) }), expect.any(AbortSignal));
  expect(jest.mocked(config.confirm).mock.calls[0][0].signing).toMatchObject({ operation: 'upload', kind: 24242 });
  expect(network.sign).toHaveBeenCalledWith(expect.objectContaining({ kind: 24242 }));
  expect(platform.fileSystem.uploadFile).toHaveBeenCalledTimes(1);
  await transferFile(runtime, 'file-two');
  for (let i = 0; i < 100 && jest.mocked(config.confirm).mock.calls.length < 2; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  expect(config.confirm).toHaveBeenCalledTimes(2);
  expect(sharedRules.size).toBe(0);
  await runtime.close();
});

it('denying an upload never signs its authorization or sends the file', async () => {
  const config = options();
  jest.mocked(config.confirm).mockResolvedValue(false);
  const runtime = new NappletRuntime(config);
  const network = jest.mocked(NappletNetwork).mock.results.at(-1)!.value;
  await runtime.open();
  await transferFile(runtime, 'denied-file');
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  expect(config.confirm).toHaveBeenCalledTimes(1);
  expect(network.sign).not.toHaveBeenCalled();
  expect(platform.fileSystem.uploadFile).not.toHaveBeenCalled();
  expect(sharedRules.size).toBe(0);
  await runtime.close();
});

describe('optional capabilities requested at call time', () => {
  let stored: Map<string, string>;
  beforeEach(() => {
    stored = new Map([['domains', '["shell"]']]);
    jest.mocked(getData).mockImplementation(async (_scope, _bucket, key) => stored.get(key) ?? null);
    jest.mocked(setData).mockImplementation(async (_scope, _bucket, key, value) => {
      if (value === null) stored.delete(key); else stored.set(key, value);
    });
  });
  afterEach(() => {
    jest.mocked(getData).mockImplementation(async () => null);
    jest.mocked(setData).mockImplementation(async () => {});
  });
  const optionalOptions = (): RuntimeOptions => ({ ...options(), domains: ['shell'],
    release: { ...release, optional: ['config', 'theme', 'upload'] }, permissionsChanged: jest.fn() });

  test.each([
    ['theme', 'get', 'theme.get.result'], ['storage', 'keys', 'storage.keys.result'], ['config', 'get', 'config.values'],
  ])('allows default optional %s access without review but honors explicit denial', async (domain, operation, response) => {
    const config = optionalOptions();
    config.release = { ...config.release, optional: [domain] };
    const runtime = new NappletRuntime(config);
    await runtime.open();
    try {
      await runtime.receive(JSON.stringify({ type: `${domain}.${operation}`, id: 'default' }));
      expect(config.confirm).not.toHaveBeenCalled();
      expect(messages().at(-1)).toMatchObject({ type: response, id: 'default' });
      expect(messages().at(-1)?.error).toBeUndefined();
    } finally { await runtime.close(); }
    stored.set('denied-domains', JSON.stringify([domain]));
    const blocked = new NappletRuntime({ ...config, domains: ['shell'] });
    await blocked.open();
    try {
      await blocked.receive(JSON.stringify({ type: `${domain}.${operation}`, id: 'blocked' }));
      expect(config.confirm).not.toHaveBeenCalled();
      expect(messages().at(-1)).toMatchObject({ type: response, id: 'blocked', error: 'permission-denied' });
    } finally { await blocked.close(); }
  });

  test('exposes default-enabled optional configuration without approval', async () => {
    const config = optionalOptions();
    const runtime = new NappletRuntime(config);
    await runtime.open();
    try {
      await runtime.receive(JSON.stringify({ type: 'shell.ready', id: 'ready' }));
      expect(messages().at(-1)?.capabilities.domains).toEqual(['shell', 'config', 'theme', 'upload']);
      await runtime.receive(JSON.stringify({ type: 'config.registerSchema', id: 'schema', schema: { type: 'object', properties: {} } }));
      expect(messages()).toContainEqual({ type: 'config.registerSchema.result', id: 'schema', ok: true });
      await runtime.receive(JSON.stringify({ type: 'config.openSettings' }));
      expect(config.configure).toHaveBeenCalledWith({ type: 'object', properties: {} }, {});
      expect(config.confirm).not.toHaveBeenCalled();
    } finally { await runtime.close(); }
  });

  test('shares concurrent approval and preserves grants for different domains', async () => {
    const config = optionalOptions();
    config.release = { ...config.release, optional: ['inc', 'resource'] };
    const runtime = new NappletRuntime(config);
    await runtime.open();
    try {
      await Promise.all(['inc.channel.list', 'inc.channel.list', 'resource.info'].map((type, index) => runtime.receive(JSON.stringify({ type, id: String(index) }))));
      expect(config.confirm).toHaveBeenCalledTimes(2);
      expect(JSON.parse(stored.get('domains')!)).toEqual(['shell', 'inc', 'resource']);
      expect(messages().filter(message => ['inc.channel.list.result', 'resource.info.result'].includes(message.type))).toHaveLength(3);
    } finally { await runtime.close(); }
  });

  test.each(['bytes', 'bytesMany'])('preserves resource.%s cancellation during shared optional consent', async operation => {
    const config = optionalOptions();
    config.release = { ...config.release, optional: ['resource'] };
    let allow!: (value: string) => void;
    let showPrompt!: () => void;
    const shown = new Promise<void>(resolve => { showPrompt = resolve; });
    jest.mocked(config.confirm).mockImplementation(() => new Promise(resolve => {
      allow = resolve;
      showPrompt();
    }));
    const runtime = new NappletRuntime(config);
    await runtime.open();
    const cancelled = { type: `resource.${operation}`, id: 'cancelled',
      ...(operation === 'bytes' ? { url: 'https://cancelled.example/' }
        : { requests: [{ url: 'https://cancelled.example/1' }, { url: 'https://cancelled.example/2' }] }) };
    try {
      const first = runtime.receive(JSON.stringify(cancelled));
      const sibling = runtime.receive(JSON.stringify({ type: 'resource.bytes', id: 'sibling', url: 'https://good.example/' }));
      await shown;
      await runtime.receive(JSON.stringify({ type: 'resource.cancel', id: 'cancelled' }));
      expect(platform.napplet.fetchResource).not.toHaveBeenCalled();
      allow('allow');
      await Promise.all([first, sibling]);
      expect(config.confirm).toHaveBeenCalledTimes(1);
      expect(platform.napplet.fetchResource).toHaveBeenCalledTimes(1);
      expect(jest.mocked(platform.napplet.fetchResource).mock.calls[0][0]).toBe('https://good.example/');
      expect(messages()).toContainEqual({ type: `resource.${operation}.error`, id: 'cancelled', error: 'session-closed' });
      expect(messages()).toContainEqual(expect.objectContaining({ type: 'resource.bytes.result', id: 'sibling' }));
      // Completing a cancelled call releases its ID and cancellation state.
      await runtime.receive(JSON.stringify({ type: 'resource.bytes', id: 'cancelled', url: 'https://retry.example/' }));
      expect(platform.napplet.fetchResource).toHaveBeenCalledTimes(2);
      expect(messages().at(-1)).toMatchObject({ type: 'resource.bytes.result', id: 'cancelled' });
    } finally { await runtime.close(); }
  });

  test('persists explicit rejection and rejects later calls without prompting', async () => {
    const config = optionalOptions();
    config.release = { ...config.release, optional: ['inc'] };
    jest.mocked(config.confirm).mockResolvedValue('deny');
    const runtime = new NappletRuntime(config);
    await runtime.open();
    try {
      for (const id of ['first', 'second']) await runtime.receive(JSON.stringify({ type: 'inc.channel.list', id }));
      expect(config.confirm).toHaveBeenCalledTimes(1);
      expect(JSON.parse(stored.get('denied-domains')!)).toEqual(['inc']);
      expect(messages().at(-1)).toMatchObject({ type: 'inc.channel.list.result', id: 'second', error: 'permission-denied' });
      expect(stored.get('domains')).toBe('["shell"]');
    } finally { await runtime.close(); }
  });

  test('does not treat cancellation as an explicit rejection', async () => {
    const config = optionalOptions();
    config.release = { ...config.release, optional: ['inc'] };
    jest.mocked(config.confirm).mockResolvedValueOnce(false);
    const runtime = new NappletRuntime(config);
    await runtime.open();
    try {
      await runtime.receive(JSON.stringify({ type: 'inc.channel.list', id: 'cancel' }));
      expect(stored.has('denied-domains')).toBe(false);
      await runtime.receive(JSON.stringify({ type: 'inc.channel.list', id: 'retry' }));
      expect(config.confirm).toHaveBeenCalledTimes(2);
      expect(messages().at(-1)).toMatchObject({ type: 'inc.channel.list.result', id: 'retry' });
    } finally { await runtime.close(); }
  });

  test.each([
    ['identity', 'getPublicKey', 'deny'], ['identity', 'getPublicKey', false],
    ['inc', 'channel.list', 'deny'], ['inc', 'channel.list', false],
  ] as const)('returns an error envelope for optional %s.%s after %s', async (domain, operation, answer) => {
    const config = optionalOptions();
    config.release = { ...config.release, optional: [domain] };
    jest.mocked(config.confirm).mockResolvedValue(answer);
    const runtime = new NappletRuntime(config);
    await runtime.open();
    try {
      await runtime.receive(JSON.stringify({ type: `${domain}.${operation}`, id: 'denied' }));
      expect(messages()).toEqual([{ type: `${domain}.${operation}.result`, id: 'denied', ok: false, error: 'permission-denied' }]);
      expect(stored.get('domains')).toBe('["shell"]');
      expect(stored.get('denied-domains')).toBe(answer === 'deny' && domain !== 'identity' ? JSON.stringify([domain]) : undefined);
    } finally { await runtime.close(); }
  });

  test('discards approval after the runtime closes', async () => {
    const config = optionalOptions();
    config.release = { ...config.release, optional: ['inc'] };
    let answer!: (value: string) => void;
    jest.mocked(config.confirm).mockImplementation(() => new Promise(resolve => { answer = resolve; }));
    const runtime = new NappletRuntime(config);
    await runtime.open();
    const pending = runtime.receive(JSON.stringify({ type: 'inc.channel.list', id: 'late' }));
    for (let index = 0; index < 10 && !answer; index++) await new Promise(resolve => setTimeout(resolve, 0));
    expect(answer).toBeDefined();
    await runtime.close();
    answer('allow');
    await pending;
    expect(stored.get('domains')).toBe('["shell"]');
    expect(messages()).toEqual([]);
  });
});


test.each(['required', 'optional'] as const)('declared %s identity uses only signer consent and shares remembered access with NIP-07', async declaration => {
  const config = options();
  config.domains = ['shell'];
  config.release = { ...release, [declaration]: ['identity'] };
  jest.mocked(getData).mockImplementation(async (_scope, _bucket, key) => key === 'denied-domains' ? '["identity"]' : null);
  jest.mocked(config.confirm).mockResolvedValue('allow-always');
  const runtime = new NappletRuntime(config);
  runtime.network.replaceable = jest.fn(async () => ({ content: JSON.stringify({ name: 'Alice', picture: 'https://example.com/avatar.png' }) } as Event));
  await runtime.open();
  try {
    await runtime.receive(JSON.stringify({ type: 'shell.ready', id: 'ready' }));
    expect(messages().at(-1)?.capabilities.domains).toContain('identity');
    await runtime.receive(JSON.stringify({ type: 'identity.getProfile', id: 'profile' }));
    expect(config.confirm).toHaveBeenCalledTimes(1);
    expect(config.confirm).toHaveBeenCalledWith(expect.objectContaining({ signing: expect.objectContaining({ operation: 'get-public-key' }) }), expect.anything());
    expect(messages().at(-1)).toMatchObject({ profile: { name: 'Alice', picture: 'https://example.com/avatar.png' } });
    await runtime.receive(JSON.stringify({ type: 'identity.getPublicKey', id: 'identity-key' }));
    await runtime.receive(JSON.stringify({ type: 'signer.getPublicKey', id: 'nip07-key' }));
    expect(config.confirm).toHaveBeenCalledTimes(1);
    expect(messages().at(-1)).toMatchObject({ result: 'accountA' });
  } finally { await runtime.close(); jest.mocked(getData).mockImplementation(async () => null); }
});

test.each(['getProfile', 'getRelays', 'getFollows', 'getMutes', 'getList', 'getZaps', 'getBadges'])('identity.%s cannot read account projections before signer approval', async operation => {
  const config = options();
  jest.mocked(config.confirm).mockResolvedValue('deny');
  const runtime = new NappletRuntime(config);
  runtime.network.replaceable = jest.fn();
  runtime.network.query = jest.fn();
  runtime.network.routes = jest.fn();
  await runtime.open();
  try {
    await runtime.receive(JSON.stringify({ type: `identity.${operation}`, id: 'denied-profile' }));
    expect(messages().at(-1)).toMatchObject({ error: 'permission-denied' });
    expect(runtime.network.replaceable).not.toHaveBeenCalled();
    expect(runtime.network.query).not.toHaveBeenCalled();
    expect(runtime.network.routes).not.toHaveBeenCalled();
  } finally { await runtime.close(); }
});


test('revocation during a public-profile read prevents disclosure', async () => {
  const runtime = new NappletRuntime(options());
  let finish!: (event: Event | null) => void;
  let reading!: () => void;
  const started = new Promise<void>(resolve => { reading = resolve; });
  runtime.network.replaceable = jest.fn(() => new Promise(resolve => { finish = resolve; reading(); }));
  await runtime.open();
  try {
    const pending = runtime.receive(JSON.stringify({ type: 'identity.getProfile', id: 'revoked-profile' }));
    await started;
    invalidateSigning(appSigningScope(runtime.scope));
    finish({ content: JSON.stringify({ name: 'Alice' }) } as Event);
    await pending;
    expect(messages().at(-1)).toMatchObject({ error: 'permission-revoked' });
    expect(messages().at(-1)?.profile).toBeUndefined();
  } finally { await runtime.close(); }
});
