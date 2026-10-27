import type { Event } from 'nostr-tools';
import type { ManagedSubscribeOptions, QueryRelayResult } from '@/services/relay/managed-relay-pool';
import { DISCOVERY_RELAYS } from '@/lib/nostr/relay-url';
import { NappletNetwork, relayUrls } from '../network';

jest.mock('@/lib/platform', () => ({ IS_ANDROID: true }));
jest.mock('@/services/relay/relay-pool', () => ({ verifyEventNativeFirst: jest.fn() }));
jest.mock('@/services/account/account-access', () => ({ buildSigner: jest.fn() }));
jest.mock('@/platform', () => ({ platform: {
  appState: { currentState: () => 'active', addChangeListener: () => () => {} },
  networkState: { addStateListener: () => () => {}, getState: async () => ({ isConnected: true, isInternetReachable: true }) },
  backgroundMessaging: { isAvailable: () => false },
} }));

const author = 'a'.repeat(64);
const relay = 'wss://publisher.example/';

it('preserves explicit relay lists beyond the former eight-relay cap', () => {
  const urls = Array.from({ length: 30 }, (_, i) => `wss://relay-${i}.example/`);
  expect(relayUrls(urls)).toEqual(urls);
});

it('queries every requested relay and returns more than 500 events', async () => {
  const network = new NappletNetwork('account');
  const urls = Array.from({ length: 30 }, (_, i) => `wss://relay-${i}.example/`);
  const query = jest.spyOn(network.pool, 'query').mockImplementation(async options => {
    for (let i = 0; i < 600; i++) options.onEvent?.({ id: String(i), kind: 1, tags: [], content: '' } as unknown as Event);
    return { events: [], status: 'complete' as const, relays: urls.map(url => ({ url, status: 'eose' as const, received: 20 })) };
  });
  try {
    const received = jest.fn();
    const result = await network.query(urls, [{ kinds: [1], limit: 100000 }], undefined, undefined, 10000, received);
    expect(query.mock.calls[0][0].relays).toEqual(urls);
    expect(result.events).toHaveLength(600);expect(result.incomplete).toBe(false);
    expect(received).toHaveBeenCalledTimes(600);
  } finally { network.destroy(); }
});

it('fetches relay metadata for every outbox author before producing grouped routes', async () => {
  const network = new NappletNetwork('account');
  const authors = Array.from({ length: 150 }, (_, i) => i.toString(16).padStart(64, '0'));
  const lookup = jest.spyOn(network, 'replaceable').mockImplementation(async () => ({ tags: [['r', 'wss://shared-a.example/'], ['r', 'wss://shared-b.example/']] } as Event));
  try {
    const groups = await network.outboxRoutes(authors, new AbortController().signal);
    expect(lookup).toHaveBeenCalledTimes(150);
    expect([...groups.values()]).toEqual([authors, authors]);
  } finally { network.destroy(); }
});

it.each([
  [{ url: relay, status: 'eose', received: 0 }, false, undefined],
  [{ url: relay, status: 'eose', received: 0, reason: 'auth-required: sign in' }, true, 'network-error'],
  [{ url: relay, status: 'eose', received: 0, reason: 'query timed out' }, true, 'network-error'],
  [{ url: relay, status: 'connection-failed', received: 0, reason: 'TLS failed' }, true, 'network-error'],
] as [QueryRelayResult, boolean, string | undefined][])('distinguishes an actual EOSE from a rejected or timed-out read', async (result, incomplete, error) => {
  const network = new NappletNetwork('account');
  let subscription!: ManagedSubscribeOptions;
  const close = jest.fn();
  jest.spyOn(network.pool, 'subscribe').mockImplementation((options) => { subscription = options; return close; });
  try {
    const pending = network.query([relay], [{ authors: [author], kinds: [35129], '#d': ['App/应用'], limit: 1 }]);
    subscription.onEnd?.([result]);
    await expect(pending).resolves.toEqual({ events: [], eventRelays: new Map(), incomplete, error });
    expect(close).toHaveBeenCalled();
  } finally { network.destroy(); }
});

it.each(['eose', 'connection-failed'] as const)('preserves events from a hinted relay when another relay reports %s', async status => {
  const network = new NappletNetwork('account');
  const subscriptions = new Map<string, ManagedSubscribeOptions>();
  jest.spyOn(network.pool, 'subscribe').mockImplementation(options => { subscriptions.set(options.relays[0], options); return () => {}; });
  const event = { id: 'b'.repeat(64), pubkey: author, kind: 35129, created_at: 100, content: 'App', tags: [['d', 'App/应用']], sig: 'c'.repeat(128) } as Event;
  try {
    const pending = network.query([relay, 'wss://market.example/'], [{ authors: [author], kinds: [35129], '#d': ['App/应用'], limit: 1 }]);
    const publisher = subscriptions.get(relay)!;
    publisher.onEvent({ ...event, id: 'd'.repeat(64), tags: [['d', 'app/应用']] }, relay);
    publisher.onEvent(event, relay);
    publisher.onEnd?.([{ url: relay, status: 'eose', received: 1 }]);
    subscriptions.get('wss://market.example/')!.onEnd?.([{ url: 'wss://market.example/', status, received: 0 }]);
    await expect(pending).resolves.toMatchObject({ events: [event], eventRelays: new Map([[event.id, [relay]]]), incomplete: status !== 'eose', error: undefined });
    expect(publisher.filters).toEqual([{ authors: [author], kinds: [35129], '#d': ['App/应用'], limit: 1 }]);
  } finally { network.destroy(); }
});

it('preserves a successful empty response when another relay exceeds the read budget', async () => {
  const network = new NappletNetwork('account');
  const subscriptions = new Map<string, ManagedSubscribeOptions>();
  jest.spyOn(network.pool, 'subscribe').mockImplementation(options => {
    const url = options.relays[0];
    subscriptions.set(url, options);
    const aborted = () => options.onEnd?.([{ url, status: 'closed', received: 0, reason: 'query aborted' }]);
    options.abort?.addEventListener('abort', aborted, { once: true });
    return () => options.abort?.removeEventListener('abort', aborted);
  });
  try {
    const pending = network.query([relay, 'wss://slow.example/'], [{ kinds: [1111] }], undefined, undefined, 100);
    subscriptions.get(relay)!.onEnd?.([{ url: relay, status: 'eose', received: 0 }]);
    await expect(pending).resolves.toMatchObject({ events: [], incomplete: true, error: undefined });
  } finally { network.destroy(); }
});

it('discovers NIP-65 on metadata relays and returns only safe write or unmarked destinations', async () => {
  const network = new NappletNetwork('account');
  const event = { id: 'b'.repeat(64), pubkey: author, kind: 10002, created_at: 100, content: '', sig: 'c'.repeat(128), tags: [
    ['r', 'wss://read-only.example', 'read'], ['r', 'wss://write.example', 'write'],
    ['r', 'wss://unmarked.example'], ['r', 'wss://write.example/', 'write'],
    ['r', 'https://invalid.example'], ['r', 'wss://127.0.0.1'],
  ] } as Event;
  const query = jest.spyOn(network, 'query').mockResolvedValue({ events: [event], incomplete: false });
  try {
    expect(await network.publisherRelays(author)).toEqual(['wss://write.example/', 'wss://unmarked.example/']);
    expect(query.mock.calls[0][0]).toEqual(expect.arrayContaining(DISCOVERY_RELAYS));
    expect(query.mock.calls[0][1]).toEqual([{ authors: [author], kinds: [10002], limit: 1 }]);
    await network.publisherRelays(author);
    expect(query).toHaveBeenCalledTimes(1);
  } finally { network.destroy(); }
});

it('coalesces publisher relay-list lookups before resolving author routes', async () => {
  const network = new NappletNetwork('account'), other = 'b'.repeat(64);
  const events = [author, other].map((pubkey, index) => ({ id: String(index + 1).repeat(64), pubkey, kind: 10002, created_at: 100,
    content: '', sig: 'c'.repeat(128), tags: [['r', `wss://author-${index}.example/`]] }) as Event);
  const query = jest.spyOn(network, 'query').mockResolvedValue({ events, incomplete: false });
  try {
    await expect(Promise.all([network.publisherRelays(author), network.publisherRelays(other)])).resolves.toEqual([
      ['wss://author-0.example/'], ['wss://author-1.example/'],
    ]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]).toEqual([{ kinds: [10002], authors: [author, other], limit: 2 }]);
  } finally { network.destroy(); }
});
