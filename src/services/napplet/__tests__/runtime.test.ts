import { rules as sharedRules, activity as sharedActivity } from '@/services/signing/testing/memory-repository';
import type { EventTemplate } from 'nostr-tools';
import { NappletRuntime, type RuntimeOptions } from '../runtime';
import { NAP_DOMAINS, type NappletRelease } from '../protocol';
import { platform } from '@/platform';
import { NAPPLET_FRAME_READY_MESSAGE } from '@/platform/ports/napplet';
import { getData, setData } from '../repository';
import { NappletNetwork } from '../network';
import { invalidateSigning } from '@/services/signing/changes';
import { appSigningScope } from '../signing-permissions';

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
  key: `35129:${'b'.repeat(64)}:app`,
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
    expect(messages()).toEqual([]);
  } finally { await restricted.close(); }
});

test.each([24242, 27235])('blocks generic publication of HTTP authorization kind %s', async (kind) => {
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
      { accountPubkey: 'accountA', appKey: release.key },
      'storage',
      'state',
      'A',
    );
    expect(getData).toHaveBeenCalledWith(
      { accountPubkey: 'accountB', appKey: release.key },
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
test('the pinned shim intent request and delivery envelopes are preserved', async () => {
  const config = options();
  const target = {
    ...release,
    key: 'target',
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
test('ungranted domains and reply-shaped messages cannot invoke a handler', async () => {
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
    expect(messages()).toEqual([]);
  } finally {
    await runtime.close();
  }
  expect(NappletNetwork).toHaveBeenCalledWith('accountA');
});

test.each([
  { kind: 30000, tags: [['d', 'psstpsst-contacts']] },
  { kind: 30078, tags: [['d', 'psstpsst-saved-groups']] },
  { kind: 10007, tags: [] },
])('generic publication cannot change account configuration: $kind', async (event) => {
  const config = options();
  const runtime = new NappletRuntime(config);
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
      error: 'publication-blocked',
    });
    expect(config.confirm).not.toHaveBeenCalled();
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
            id: release.key,
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

test('late remote signatures are discarded without publishing an expired request', async () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
  const runtime = new NappletRuntime(options());
  runtime.network.routes = jest.fn(async () => ['wss://relay.example/']);
  jest.mocked(runtime.network.sign).mockImplementation(async () => {
    now.mockReturnValue(31000);
    return { id: 'late-signature' } as never;
  });
  try {
    await runtime.open();
    await runtime.receive(JSON.stringify({ type: 'outbox.publish', id: 'late',
      event: { kind: 1, content: 'Expired', tags: [] } }));
    expect(runtime.network.publish).not.toHaveBeenCalled();
    expect(messages()).toContainEqual(expect.objectContaining({ id: 'late', error: 'timeout' }));
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

it('asks for each file as app consent and signs Blossom authentication only after approval', async () => {
  const config = options();
  const runtime = new NappletRuntime(config);
  const network = jest.mocked(NappletNetwork).mock.results.at(-1)!.value;
  jest.mocked(network.sign).mockImplementation(async (template: EventTemplate) => ({ ...template, pubkey: 'a'.repeat(64), id: 'b'.repeat(64), sig: 'd'.repeat(128) }));
  await runtime.open();
  await transferFile(runtime, 'file-one');
  for (let i = 0; i < 100 && !jest.mocked(platform.fileSystem.uploadFile).mock.calls.length; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  expect(config.confirm).toHaveBeenCalledWith(expect.objectContaining({ upload: expect.objectContaining({ filename: 'report.txt', size: 3 }) }), expect.any(AbortSignal));
  expect(jest.mocked(config.confirm).mock.calls[0][0].signing).toBeUndefined();
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
