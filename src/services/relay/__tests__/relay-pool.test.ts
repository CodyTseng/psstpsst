import { finalizeEvent, generateSecretKey, verifiedSymbol, verifyEvent, type Event } from 'nostr-tools';
import { AbstractRelay } from 'nostr-tools/abstract-relay';

import { verifyAcceleratedSchnorr } from '@/services/crypto/crypto-accelerator';

import { ManagedRelayPool } from '../managed-relay-pool';
import { relayPool } from '../relay-pool';
import { RelayQueryError } from '../relay-query-error';

const mockQuery = jest.fn();
jest.mock('../managed-relay-pool', () => ({
  ManagedRelayPool: jest.fn().mockImplementation(() => ({
    query: (...args: unknown[]) => mockQuery(...args),
  })),
}));
jest.mock('@/services/crypto/crypto-accelerator', () => ({ verifyAcceleratedSchnorr: jest.fn() }));
jest.mock('@/lib/platform', () => ({ IS_ANDROID: false }));
jest.mock('@/platform', () => ({
  platform: { appState: { currentState: () => 'active' } },
}));

beforeEach(() => {
  jest.useFakeTimers();
  mockQuery.mockReset();
  jest.mocked(verifyAcceleratedSchnorr).mockReset();
});

afterEach(() => jest.useRealTimers());

it.each(['content', 'signature'] as const)(
  'rejects a gift wrap with forged %s before cross-relay deduplication',
  async (forgery) => {
    const { ManagedRelayPool: RealManagedRelayPool } = jest.requireActual<typeof import('../managed-relay-pool')>(
      '../managed-relay-pool',
    );
    const { verifyEvent: verifyRelayEvent } = jest.mocked(ManagedRelayPool).mock.calls[0][0];
    const relays: AbstractRelay[] = [];
    const pool = new RealManagedRelayPool({
      verifyEvent: verifyRelayEvent,
      observeLifecycle: false,
      relayFactory: (url, options) => {
        const relay = new AbstractRelay(url, options);
        jest.spyOn(relay, 'connect').mockResolvedValue();
        jest.spyOn(relay, 'connected', 'get').mockReturnValue(true);
        jest.spyOn(relay, 'send').mockResolvedValue();
        relays.push(relay);
        return relay;
      },
    });
    const onEvent = jest.fn();
    const onInvalidEvent = jest.fn();
    const valid = finalizeEvent({ kind: 1059, created_at: 100, tags: [], content: 'ciphertext' }, generateSecretKey());
    const forged = forgery === 'content'
      ? { ...valid, content: 'tampered ciphertext' }
      : { ...valid, sig: '0'.repeat(128) };
    // Wire serialization strips the sender's local verification cache.
    const deliver = (relay: AbstractRelay, event: Event) => {
      const subscription = Array.from(relay.openSubs.values())[0];
      expect(subscription).toBeDefined();
      relay._onmessage({ data: JSON.stringify(['EVENT', subscription.id, event]) } as MessageEvent);
    };
    try {
      pool.subscribe({
        relays: ['wss://a.example', 'wss://b.example'],
        filter: { kinds: [1059] },
        onEvent,
        onInvalidEvent,
      });
      await Promise.resolve();
      await Promise.resolve();
      deliver(relays[0], forged);
      expect(onInvalidEvent).toHaveBeenCalledTimes(1);
      expect(onEvent).not.toHaveBeenCalled();

      deliver(relays[1], valid);
      expect(onEvent).toHaveBeenCalledTimes(1);
      const received = onEvent.mock.calls[0][0];
      expect(received.id).toBe(valid.id);
      expect(received[verifiedSymbol]).toBe(true);
      expect(verifyEvent(received)).toBe(true);

      deliver(relays[0], valid);
      expect(onEvent).toHaveBeenCalledTimes(1);
    } finally {
      pool.destroy();
    }
  },
);

it('caches accelerated gift wrap verification for downstream consumers', () => {
  const { verifyEvent: verifyRelayEvent } = jest.mocked(ManagedRelayPool).mock.calls[0][0];
  const event: Event = JSON.parse(JSON.stringify(finalizeEvent(
    { kind: 1059, created_at: 100, tags: [], content: 'ciphertext' }, generateSecretKey(),
  )));
  jest.mocked(verifyAcceleratedSchnorr).mockReturnValue(true);

  expect(verifyRelayEvent(event, 'wss://a.example')).toBe(true);
  expect(verifyAcceleratedSchnorr).toHaveBeenCalledTimes(1);
  expect(event[verifiedSymbol]).toBe(true);
  expect(verifyEvent(event)).toBe(true);
  expect(verifyRelayEvent(event, 'wss://a.example')).toBe(true);
  expect(verifyAcceleratedSchnorr).toHaveBeenCalledTimes(1);
});

it('reports an empty successful lookup through completion', async () => {
  mockQuery.mockResolvedValue({ events: [], status: 'complete', relays: [] });
  const onComplete = jest.fn();
  await expect(relayPool.query({ relays: ['wss://a.example'], filter: {}, onComplete })).resolves.toEqual([]);
  expect(onComplete).toHaveBeenCalledWith({ eosed: true, status: 'complete', relays: [] });
});

it('throws a network error instead of returning an empty result when all relays fail', async () => {
  const relays = [{ url: 'wss://a.example', status: 'connection-failed', received: 0 }];
  mockQuery.mockResolvedValue({ events: [], status: 'failed', relays });
  const onComplete = jest.fn();
  await expect(relayPool.query({ relays: ['wss://a.example'], filter: {}, onComplete }))
    .rejects.toBeInstanceOf(RelayQueryError);
  expect(onComplete).toHaveBeenCalledWith({ eosed: false, status: 'failed', relays });
});

it('distinguishes caller cancellation from network failure', async () => {
  const controller = new AbortController();
  controller.abort();
  mockQuery.mockResolvedValue({ events: [], status: 'failed', relays: [] });
  await expect(relayPool.query({ relays: ['wss://a.example'], filter: {}, abort: controller.signal }))
    .rejects.toMatchObject({ name: 'AbortError' });
});

it('does not report successful completion when a remaining relay is cancelled', async () => {
  const controller = new AbortController();
  const onComplete = jest.fn();
  mockQuery.mockImplementation(async () => {
    controller.abort();
    return {
      events: [], status: 'complete',
      relays: [
        { url: 'wss://a.example', status: 'eose', received: 0 },
        { url: 'wss://b.example', status: 'closed', reason: 'query aborted', received: 0 },
      ],
    };
  });
  await expect(relayPool.query({
    relays: ['wss://a.example', 'wss://b.example'], filter: {}, abort: controller.signal, onComplete,
  })).rejects.toMatchObject({ name: 'AbortError' });
  expect(onComplete).not.toHaveBeenCalled();
});

it('forwards optional lifecycle callbacks to the shared query implementation', async () => {
  const onclose = jest.fn();
  const onerror = jest.fn();
  const oneosed = jest.fn();
  mockQuery.mockResolvedValue({ events: [], status: 'complete', relays: [] });
  await relayPool.query({ relays: ['wss://a.example'], filter: {}, onclose, onerror, oneosed });
  expect(mockQuery).toHaveBeenCalledWith(expect.objectContaining({ onclose, onerror, oneosed }), expect.any(Function));
});

it('uses the public subscribe method to create the query subscription', async () => {
  const close = jest.fn();
  const subscribe = jest.spyOn(relayPool, 'subscribe').mockReturnValue(close);
  try {
    mockQuery.mockImplementation(async (_options, startSubscription) => {
      const stop = startSubscription({ relays: ['wss://a.example'], filter: {}, onEvent: () => {} });
      stop();
      return { events: [], status: 'complete', relays: [] };
    });
    await relayPool.query({ relays: ['wss://a.example'], filter: {} });
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  } finally {
    subscribe.mockRestore();
  }
});
