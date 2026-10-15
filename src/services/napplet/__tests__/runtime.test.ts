import { NappletRuntime, type RuntimeOptions } from '../runtime';
import { NAP_DOMAINS, type NappletRelease } from '../protocol';
import { platform } from '@/platform';
import { getData, setData } from '../repository';
import { NappletNetwork } from '../network';

jest.mock('@/i18n/core', () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock('@/platform', () => ({
  platform: {
    napplet: {
      open: jest.fn(async () => 'container'),
      close: jest.fn(async () => {}),
      send: jest.fn(async () => {}),
      fetchResource: jest.fn(async (url: string) => {
        if (url.includes('bad.example')) throw new Error('network-error');
        return new TextEncoder().encode('{}');
      }),
      addMessageListener: jest.fn(() => () => {}),
    },
    urlOpener: { openExternalUrl: jest.fn(async () => true) },
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
  key: '35129:publisher:app',
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
  jest.clearAllMocks();
});

test('storage operations always use the endpoint account and verified artifact', async () => {
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
      { accountPubkey: 'accountA', appKey: release.key, artifactHash: release.hash },
      'storage',
      'state',
      'A',
    );
    expect(getData).toHaveBeenCalledWith(
      { accountPubkey: 'accountB', appKey: release.key, artifactHash: release.hash },
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
