import type { Event } from 'nostr-tools';
import type { ManagedSubscribeOptions, QueryRelayResult } from '@/services/relay/managed-relay-pool';
import { DISCOVERY_RELAYS } from '@/lib/nostr/relay-url';
import { NappletNetwork } from '../network';

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
    await expect(pending).resolves.toEqual({ events: [], incomplete, error });
    expect(close).toHaveBeenCalled();
  } finally { network.destroy(); }
});

it('preserves events from a hinted relay while other relays end their initial read', async () => {
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
    subscriptions.get('wss://market.example/')!.onEnd?.([{ url: 'wss://market.example/', status: 'eose', received: 0 }]);
    await expect(pending).resolves.toMatchObject({ events: [event], incomplete: false });
    expect(publisher.filters).toEqual([{ authors: [author], kinds: [35129], '#d': ['App/应用'], limit: 1 }]);
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
