import type { Event, Filter } from 'nostr-tools';
import type {
  AbstractRelay,
  AbstractRelayConstructorOptions,
  Subscription,
  SubscriptionParams,
} from 'nostr-tools/abstract-relay';

import { ManagedRelayPool } from '../managed-relay-pool';

let mockAppState = 'active';
let mockPulse: (() => void) | undefined;
jest.mock('@/lib/platform', () => ({ IS_ANDROID: true }));
jest.mock('@/platform', () => ({
  platform: {
    appState: { currentState: () => mockAppState, addChangeListener: jest.fn(() => () => {}) },
    backgroundMessaging: {
      isAvailable: () => true,
      addPulseListener: (listener: () => void) => { mockPulse = listener; return () => {}; },
      schedulePulse: jest.fn(async () => {}),
    },
  },
}));

const RELAY_A = 'wss://relay-a.example/';
const RELAY_B = 'wss://relay-b.example/';

describe('ManagedRelayPool', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockAppState = 'active';
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('requires fresh wire traffic and actual EOSE on every relay before skipping a poll', async () => {
    const { pool, relays } = createHarness();
    pool.subscribe({ label: 'dm.live', relays: [RELAY_A, RELAY_B], filter: { kinds: [1059] }, onEvent: () => {} });
    await flushPromises();
    expect(relays[0].pingFrequency).toBe(60_000);
    expect(pool.hasHealthySubscription('dm.live')).toBe(false);
    relays[0].emitEose();
    expect(pool.hasHealthySubscription('dm.live')).toBe(false);
    relays[1].emitEose();
    expect(pool.hasHealthySubscription('dm.live')).toBe(true);
    jest.setSystemTime(Date.now() + 90_001);
    expect(pool.hasHealthySubscription('dm.live')).toBe(false);
    for (const relay of relays) relay._onmessage({ data: 'heartbeat response' } as MessageEvent);
    expect(pool.hasHealthySubscription('dm.live')).toBe(true);
    relays[0].hardClose();
    expect(pool.hasHealthySubscription('dm.live')).toBe(false);
    pool.destroy();
  });

  test('does not treat a query deadline as proof of a healthy subscription', async () => {
    const { pool } = createHarness();
    pool.subscribe({ label: 'dm.live', relays: [RELAY_A], filter: { kinds: [1059] }, onEvent: () => {} });
    await flushPromises();
    await jest.advanceTimersByTimeAsync(6_000);
    expect(pool.hasHealthySubscription('dm.live')).toBe(false);
    pool.destroy();
  });

  test('backs off persistently failing background connections to five minutes', async () => {
    mockAppState = 'background';
    const { pool, relays } = createHarness(Array.from({ length: 12 }, () => new Error('offline')));
    pool.subscribe({ relays: [RELAY_A], filter: { kinds: [1] }, onEvent: () => {} });
    await flushPromises();
    for (const delay of [1_000, 2_000, 5_000, 10_000, 20_000, 30_000, 60_000, 120_000]) {
      await jest.advanceTimersByTimeAsync(delay);
    }
    expect(relays).toHaveLength(9);
    await jest.advanceTimersByTimeAsync(299_999);
    expect(relays).toHaveLength(9);
    await jest.advanceTimersByTimeAsync(1);
    expect(relays).toHaveLength(10);
    pool.destroy();
  });

  test('keeps retrying an initially failed relay while durable demand exists', async () => {
    const harness = createHarness([new Error('offline'), null]);
    const statuses: string[] = [];
    const unsubscribe = harness.pool.subscribe({
      relays: [RELAY_A],
      filter: { kinds: [1] },
      onEvent: () => {},
      onStatusChange: (status) => statuses.push(status),
    });

    await flushPromises();
    expect(harness.relays).toHaveLength(1);
    expect(statuses).toEqual(['connecting']);

    await jest.advanceTimersByTimeAsync(1_000);
    await flushPromises();

    expect(harness.relays).toHaveLength(2);
    expect(harness.relays[1].subscriptions).toHaveLength(1);
    expect(statuses).toEqual(['connecting', 'connected']);
    unsubscribe();
    harness.pool.destroy();
  });

  test('attaches each late subscription once to an already connected relay', async () => {
    const harness = createHarness();
    await harness.pool.ensureRelay(RELAY_A);
    expect(harness.relays[0].subscriptions).toHaveLength(0);

    harness.pool.subscribe({
      relays: [RELAY_A],
      filter: { kinds: [4455], '#p': ['client'] },
      onEvent: () => {},
    });
    await flushPromises();

    expect(harness.relays).toHaveLength(1);
    expect(harness.relays[0].subscriptions).toHaveLength(1);
    expect(harness.relays[0].subscriptions[0].filters).toEqual([
      { kinds: [4455], '#p': ['client'] },
    ]);

    harness.pool.subscribe({
      relays: [RELAY_A],
      filter: { kinds: [23195], '#p': ['wallet'] },
      onEvent: () => {},
    });
    await flushPromises();

    expect(harness.relays[0].subscriptions).toHaveLength(2);
    expect(harness.relays[0].subscriptions[1].filters).toEqual([
      { kinds: [23195], '#p': ['wallet'] },
    ]);
    harness.pool.destroy();
  });

  test('recreates a dropped subscription with its original filter', async () => {
    const harness = createHarness();
    const received: number[] = [];
    const filter: Filter = { kinds: [1059], since: 100 };
    harness.pool.subscribe({
      relays: [RELAY_A],
      filter,
      onEvent: (event) => received.push(event.created_at),
    });

    await flushPromises();
    const first = harness.relays[0];
    first.emitEvent(eventAt('1', 200));
    first.hardClose();

    await jest.advanceTimersByTimeAsync(1_000);
    await flushPromises();

    const second = harness.relays[1];
    expect(second.subscriptions[0].filters[0]).toEqual({ kinds: [1059], since: 100 });
    second.emitEvent(eventAt('2', 150));
    expect(received).toEqual([200, 150]);
    expect(filter).toEqual({ kinds: [1059], since: 100 });
    harness.pool.destroy();
  });

  test('native pulse drives a frozen physical-subscription retry', async () => {
    const harness = createHarness();
    harness.pool.subscribe({
      relays: [RELAY_A],
      filter: { kinds: [1059], since: 100 },
      onEvent: () => {},
    });
    await flushPromises();

    const closedAt = Date.now();
    harness.relays[0].serverClose('closed by relay');
    jest.setSystemTime(closedAt + 999);
    mockPulse!();
    expect(harness.relays[0].subscriptions).toHaveLength(1);

    jest.setSystemTime(closedAt + 1_000);
    mockPulse!();

    expect(harness.relays).toHaveLength(1);
    expect(harness.relays[0].subscriptions[1].filters).toEqual([
      { kinds: [1059], since: 100 },
    ]);
    harness.pool.destroy();
  });

  test('keeps a multi-filter subscription combined across reconnects', async () => {
    const harness = createHarness();
    const filters: Filter[] = [
      { kinds: [1059], '#p': ['self'], since: 100 },
      { kinds: [4454], authors: ['self'], since: 200 },
      { kinds: [10044], authors: ['self'] },
    ];
    harness.pool.subscribe({
      relays: [RELAY_A],
      filters,
      onEvent: () => {},
    });

    await flushPromises();
    expect(harness.relays[0].subscriptions).toHaveLength(1);
    expect(harness.relays[0].subscriptions[0].filters).toEqual(filters);

    harness.relays[0].hardClose();
    await jest.advanceTimersByTimeAsync(1_000);
    await flushPromises();

    expect(harness.relays[1].subscriptions).toHaveLength(1);
    expect(harness.relays[1].subscriptions[0].filters).toEqual(filters);
    expect(filters).toEqual([
      { kinds: [1059], '#p': ['self'], since: 100 },
      { kinds: [4454], authors: ['self'], since: 200 },
      { kinds: [10044], authors: ['self'] },
    ]);
    harness.pool.destroy();
  });

  test('reports the first relay while preserving pre-dedup receipts for combined filters', async () => {
    const harness = createHarness();
    const events: string[] = [];
    const receipts: string[] = [];
    harness.pool.subscribe({
      relays: [RELAY_A, RELAY_B],
      filters: [{ kinds: [1059] }, { kinds: [4454] }],
      onEvent: (_event, relayUrl) => events.push(relayUrl),
      onReceived: (relayUrl) => receipts.push(relayUrl),
    });

    await flushPromises();
    const event = eventAt('same', 100);
    harness.relays[0].emitEvent(event);
    harness.relays[1].emitEvent(event);

    expect(events).toEqual([RELAY_A.slice(0, -1)]);
    expect(receipts).toEqual([RELAY_A.slice(0, -1), RELAY_B.slice(0, -1)]);
    harness.pool.destroy();
  });

  test('does not resurrect a subscription cancelled during retry backoff', async () => {
    const harness = createHarness([new Error('offline')]);
    const unsubscribe = harness.pool.subscribe({
      relays: [RELAY_A],
      filter: { kinds: [1] },
      onEvent: () => {},
    });
    await flushPromises();

    unsubscribe();
    await jest.advanceTimersByTimeAsync(60_000);

    expect(harness.relays).toHaveLength(1);
    harness.pool.destroy();
  });

  test('authenticates once and recreates an auth-gated subscription', async () => {
    const harness = createHarness();
    const received: string[] = [];
    harness.pool.subscribe({
      relays: [RELAY_A],
      filter: { kinds: [1059] },
      signAuth: async () => eventAt('auth', 100),
      onEvent: (event) => received.push(event.id),
    });
    await flushPromises();

    const relay = harness.relays[0];
    relay.serverClose('auth-required: authenticate to read');
    await flushPromises();

    expect(relay.authCalls).toBe(1);
    expect(relay.subscriptions).toHaveLength(2);
    relay.emitEvent(eventAt('accepted', 101));
    expect(received).toEqual([eventAt('accepted', 101).id]);
    harness.pool.destroy();
  });

  test('retries a transient server-closed subscription without replacing its socket', async () => {
    const harness = createHarness();
    harness.pool.subscribe({
      relays: [RELAY_A],
      filter: { kinds: [1059] },
      onEvent: () => {},
    });
    await flushPromises();

    const relay = harness.relays[0];
    relay.serverClose('rate-limited: slow down');
    await jest.advanceTimersByTimeAsync(1_000);

    expect(harness.relays).toHaveLength(1);
    expect(relay.subscriptions).toHaveLength(2);
    expect(relay.subscriptions[1].filters[0]).toEqual({ kinds: [1059] });
    harness.pool.destroy();
  });

  test('does not retry a permanently rejected subscription', async () => {
    const harness = createHarness();
    harness.pool.subscribe({
      relays: [RELAY_A],
      filter: { kinds: [1059] },
      onEvent: () => {},
    });
    await flushPromises();

    const relay = harness.relays[0];
    relay.serverClose('blocked: policy');
    await harness.pool.ensureRelay(RELAY_A);
    await jest.advanceTimersByTimeAsync(60_000);

    expect(relay.subscriptions).toHaveLength(1);
    harness.pool.destroy();
  });

  test('immediately replaces demanded sockets during lifecycle recovery', async () => {
    const harness = createHarness();
    const statuses: string[] = [];
    harness.pool.subscribe({
      relays: [RELAY_A],
      filter: { kinds: [10044] },
      onEvent: () => {},
      onStatusChange: (status) => statuses.push(status),
    });
    await flushPromises();

    harness.pool.recoverConnections();
    await flushPromises();

    expect(harness.relays).toHaveLength(2);
    expect(harness.relays[1].subscriptions[0].filters[0]).toEqual({ kinds: [10044] });
    expect(statuses).toEqual(['connecting', 'connected', 'connecting', 'connected']);
    harness.pool.destroy();
  });

  test('EOSE and timeout leave subscriptions receiving until the owner closes them', async () => {
    const harness = createHarness();
    const onEose = jest.fn();
    const onEvent = jest.fn();
    const close = harness.pool.subscribe({
      relays: [RELAY_A, RELAY_B], filter: {}, timeoutMs: 1_000, onEose, onEvent,
    });
    await flushPromises();
    harness.relays[0].emitEose();
    await jest.advanceTimersByTimeAsync(999);
    expect(onEose).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(onEose).toHaveBeenCalledTimes(1);
    expect(harness.relays[0].subscriptions[0].subscription.closed).toBe(false);
    expect(harness.relays[1].subscriptions[0].subscription.closed).toBe(false);
    harness.relays[0].emitEvent(eventAt('after-eose', 100));
    harness.relays[1].emitEvent(eventAt('after-timeout', 200));
    expect(onEvent).toHaveBeenCalledTimes(2);

    harness.relays[1].hardClose();
    await jest.advanceTimersByTimeAsync(1_000);
    expect(harness.relays).toHaveLength(3);
    harness.relays[2].emitEvent(eventAt('after-reconnect', 300));
    expect(onEvent).toHaveBeenCalledTimes(3);
    expect(onEose).toHaveBeenCalledTimes(1);

    close();
    harness.pool.recoverConnections();
    await jest.advanceTimersByTimeAsync(30_000);
    expect(harness.relays).toHaveLength(3);
    expect(harness.relays[2].subscriptions[0].subscription.closed).toBe(true);
    harness.pool.destroy();
  });

  test('queries use subscribe and remove their reconnect demand when the read ends', async () => {
    const harness = createHarness();
    const subscribe = jest.spyOn(harness.pool, 'subscribe');
    const pending = harness.pool.query({ relays: [RELAY_A, RELAY_B], filter: {}, timeoutMs: 1_000 });
    await flushPromises();
    expect(subscribe).toHaveBeenCalledTimes(2);
    harness.relays[0].emitEose();
    await jest.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toMatchObject({ status: 'complete' });
    expect(harness.relays.every((relay) => relay.subscriptions[0].subscription.closed)).toBe(true);
    harness.pool.recoverConnections();
    await jest.advanceTimersByTimeAsync(30_000);
    expect(harness.relays).toHaveLength(2);
    expect(subscribe).toHaveBeenCalledTimes(2);
    harness.pool.destroy();
  });

  test('waits for every relay and includes events arriving after the first EOSE', async () => {
    const harness = createHarness();
    const query = harness.pool.query({
      relays: [RELAY_A, RELAY_B], filter: { kinds: [1] }, timeoutMs: 1_000,
    });
    const completed = jest.fn();
    void query.then(completed);
    await flushPromises();
    harness.relays[0].emitEvent(eventAt('early', 100));
    harness.relays[0].emitEose();
    await jest.advanceTimersByTimeAsync(500);
    expect(completed).not.toHaveBeenCalled();
    expect(harness.relays[1].subscriptions[0].subscription.closed).toBe(false);
    harness.relays[1].emitEvent(eventAt('late', 200));
    harness.relays[1].emitEose();
    await expect(query).resolves.toMatchObject({
      status: 'complete', events: [eventAt('early', 100), eventAt('late', 200)],
      relays: [{ status: 'eose' }, { status: 'eose' }],
    });
    harness.pool.destroy();
  });

  test('waits for a silent relay deadline after another sends empty EOSE', async () => {
    const harness = createHarness();
    const pending = harness.pool.query({ relays: [RELAY_A, RELAY_B], filter: {}, timeoutMs: 1_000 });
    const completed = jest.fn();
    void pending.then(completed);
    await flushPromises();
    harness.relays[0].emitEose();
    await jest.advanceTimersByTimeAsync(999);
    expect(completed).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({ status: 'complete', events: [] });
    harness.pool.destroy();
  });

  test('treats valid events followed by a deadline as EOSE', async () => {
    const harness = createHarness();
    const pending = harness.pool.query({ relays: [RELAY_A], filter: {}, timeoutMs: 1_000 });
    await flushPromises();
    harness.relays[0].emitEvent(eventAt('received', 100));
    await jest.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toMatchObject({
      status: 'complete', relays: [{ status: 'eose', received: 1 }],
    });
    harness.pool.destroy();
  });

  test('completes at the deadline while excluding unverified receipts', async () => {
    const harness = createHarness();
    const pending = harness.pool.query({ relays: [RELAY_A], filter: {}, timeoutMs: 1_000 });
    await flushPromises();
    const relay = harness.relays[0];
    // nostr-tools reports receipt before verification; rejected events never reach onevent.
    relay.subscriptions[0].params.receivedEvent?.(relay as unknown as AbstractRelay, 'invalid');
    await jest.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toMatchObject({ status: 'complete', events: [] });
    harness.pool.destroy();
  });

  test('caller cancellation releases queued siblings while preserving other queries and live subscriptions', async () => {
    const harness = createHarness([], 1);
    const blocker = harness.pool.query({ relays: [RELAY_B], filter: {}, timeoutMs: 5_000 });
    const onEvent = jest.fn();
    harness.pool.subscribe({ relays: [RELAY_A], filter: {}, onEvent });
    await flushPromises();
    const controller = new AbortController();
    const pending = harness.pool.query({
      relays: [RELAY_A, RELAY_B], filter: {}, timeoutMs: 1_000, abort: controller.signal,
    });
    await flushPromises();
    const relayA = harness.relays.find((relay) => relay.url === RELAY_A.slice(0, -1))!;
    const relayB = harness.relays.find((relay) => relay.url === RELAY_B.slice(0, -1))!;
    controller.abort();
    await expect(pending).resolves.toMatchObject({ status: 'failed' });
    relayA.emitEvent(eventAt('live', 200), 0);
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(relayB.subscriptions[0].subscription.closed).toBe(false);
    relayB.emitEose();
    await expect(blocker).resolves.toMatchObject({ status: 'complete' });
    await flushPromises();
    expect(relayB.subscriptions).toHaveLength(1);
    harness.pool.destroy();
  });

  test('completes a silent connected query without recycling its socket', async () => {
    const harness = createHarness();
    const firstQuery = harness.pool.query({
      relays: [RELAY_A],
      filter: { kinds: [10044] },
      timeoutMs: 1_000,
    });
    await flushPromises();
    await jest.advanceTimersByTimeAsync(1_000);

    const firstResult = await firstQuery;
    expect(firstResult.status).toBe('complete');
    expect(firstResult.relays[0].status).toBe('eose');

    const secondQuery = harness.pool.query({
      relays: [RELAY_A],
      filter: { kinds: [10044] },
      timeoutMs: 1_000,
    });
    await flushPromises();

    expect(harness.relays).toHaveLength(1);
    harness.relays[0].emitEose();
    await expect(secondQuery).resolves.toMatchObject({ status: 'complete' });
    harness.pool.destroy();
  });

  test('waits for all ordinary relay CLOSED responses before completing', async () => {
    const harness = createHarness();
    const pending = harness.pool.query({ relays: [RELAY_A, RELAY_B], filter: {}, timeoutMs: 1_000 });
    const completed = jest.fn();
    void pending.then(completed);
    await flushPromises();
    harness.relays[0].serverClose('restricted: query unavailable');
    await jest.advanceTimersByTimeAsync(500);
    expect(completed).not.toHaveBeenCalled();
    harness.relays[1].serverClose('rate-limited: slow down');
    await expect(pending).resolves.toMatchObject({
      status: 'complete', events: [], relays: [{ status: 'eose' }, { status: 'eose' }],
    });
    harness.pool.destroy();
  });

  test('fails when every relay cannot connect', async () => {
    const harness = createHarness([new Error('offline'), new Error('offline')]);
    const pending = harness.pool.query({ relays: [RELAY_A, RELAY_B], filter: {}, timeoutMs: 1_000 });
    await expect(pending).resolves.toMatchObject({
      status: 'failed', relays: [{ status: 'connection-failed' }, { status: 'connection-failed' }],
    });
    harness.pool.destroy();
  });

  test('does not count a connection deadline as EOSE', async () => {
    const harness = createHarness();
    jest.spyOn(harness.pool, 'ensureRelay').mockReturnValue(new Promise(() => {}));
    const pending = harness.pool.query({ relays: [RELAY_A], filter: {}, timeoutMs: 1_000 });
    await jest.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toMatchObject({
      status: 'failed', relays: [{ status: 'connection-failed', reason: 'connection timed out' }],
    });
    harness.pool.destroy();
  });

  test('pauses the query deadline during AUTH and gives the new REQ a fresh deadline', async () => {
    const harness = createHarness();
    const pending = harness.pool.query({
      relays: [RELAY_A], filter: { kinds: [10044] }, timeoutMs: 1_000,
      signAuth: async () => eventAt('auth', 100),
    });
    const completed = jest.fn();
    void pending.then(completed);
    await flushPromises();
    const relay = harness.relays[0];
    let authenticate!: (value: string) => void;
    jest.spyOn(relay, 'auth').mockReturnValue(new Promise((resolve) => { authenticate = resolve; }));
    await jest.advanceTimersByTimeAsync(900);
    relay.serverClose('auth-required: authenticate to read');
    await jest.advanceTimersByTimeAsync(2_000);
    // The library may emit a delayed synthetic EOSE for the closed subscription.
    relay.subscriptions[0].params.oneose?.();
    await flushPromises();
    expect(completed).not.toHaveBeenCalled();
    expect(relay.subscriptions).toHaveLength(1);
    authenticate('authenticated');
    await flushPromises();
    expect(relay.subscriptions).toHaveLength(2);
    expect(relay.subscriptions[1].filters).toEqual([{ kinds: [10044] }]);
    await jest.advanceTimersByTimeAsync(999);
    expect(completed).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({ status: 'complete', events: [] });
    harness.pool.destroy();
  });

  test('does not reopen an AUTH-gated query after caller cancellation', async () => {
    const harness = createHarness();
    const controller = new AbortController();
    const pending = harness.pool.query({
      relays: [RELAY_A], filter: {}, timeoutMs: 1_000, abort: controller.signal,
      signAuth: async () => eventAt('auth', 100),
    });
    await flushPromises();
    const relay = harness.relays[0];
    let authenticate!: (value: string) => void;
    jest.spyOn(relay, 'auth').mockReturnValue(new Promise((resolve) => { authenticate = resolve; }));
    relay.serverClose('auth-required: authenticate to read');
    controller.abort();
    authenticate('authenticated');
    await expect(pending).resolves.toMatchObject({ status: 'failed' });
    expect(relay.subscriptions).toHaveLength(1);
    harness.pool.destroy();
  });

  test('counts failed AUTH as EOSE', async () => {
    const harness = createHarness();
    const pending = harness.pool.query({
      relays: [RELAY_A], filter: {}, timeoutMs: 1_000,
      signAuth: async () => eventAt('auth', 100),
    });
    await flushPromises();
    const relay = harness.relays[0];
    jest.spyOn(relay, 'auth').mockRejectedValue(new Error('rejected'));
    relay.serverClose('auth-required: authenticate to read');
    await expect(pending).resolves.toMatchObject({
      status: 'complete', relays: [{ status: 'eose', reason: 'auth failed: rejected' }],
    });
    expect(relay.subscriptions).toHaveLength(1);
    harness.pool.destroy();
  });

  test('counts unavailable AUTH as EOSE and still waits for the other relay', async () => {
    const harness = createHarness();
    const pending = harness.pool.query({ relays: [RELAY_A, RELAY_B], filter: {}, timeoutMs: 1_000 });
    const completed = jest.fn();
    void pending.then(completed);
    await flushPromises();
    harness.relays[0].serverClose('auth-required: authenticate to read');
    await jest.advanceTimersByTimeAsync(500);
    expect(completed).not.toHaveBeenCalled();
    harness.relays[1].emitEvent(eventAt('late', 100));
    harness.relays[1].emitEose();
    await expect(pending).resolves.toMatchObject({
      status: 'complete', events: [eventAt('late', 100)],
      relays: [{ status: 'eose' }, { status: 'eose' }],
    });
    harness.pool.destroy();
  });

  test('counts unfinished AUTH as EOSE at its deadline and ignores late success', async () => {
    const harness = createHarness();
    const pending = harness.pool.query({
      relays: [RELAY_A], filter: {}, timeoutMs: 1_000,
      signAuth: async () => eventAt('auth', 100),
    });
    await flushPromises();
    const relay = harness.relays[0];
    let authenticate!: (value: string) => void;
    jest.spyOn(relay, 'auth').mockReturnValue(new Promise((resolve) => { authenticate = resolve; }));
    relay.serverClose('auth-required: authenticate to read');
    await jest.advanceTimersByTimeAsync(8_000);
    await expect(pending).resolves.toMatchObject({
      status: 'complete', relays: [{ status: 'eose', reason: 'auth failed: auth timed out' }],
    });
    authenticate('authenticated');
    await flushPromises();
    expect(relay.subscriptions).toHaveLength(1);
    harness.pool.destroy();
  });

  test('ends the query if the relay still requires AUTH after one successful authentication', async () => {
    const harness = createHarness();
    const pending = harness.pool.query({
      relays: [RELAY_A], filter: {}, timeoutMs: 1_000,
      signAuth: async () => eventAt('auth', 100),
    });
    await flushPromises();
    const relay = harness.relays[0];
    relay.serverClose('auth-required: authenticate to read');
    await flushPromises();
    relay.serverClose('auth-required: still restricted');
    await expect(pending).resolves.toMatchObject({ status: 'complete' });
    expect(relay.authCalls).toBe(1);
    expect(relay.subscriptions).toHaveLength(2);
    harness.pool.destroy();
  });

  test('ends an already started REQ when its socket disconnects', async () => {
    const harness = createHarness();
    const pending = harness.pool.query({ relays: [RELAY_A], filter: {}, timeoutMs: 1_000 });
    await flushPromises();
    harness.relays[0].emitEvent(eventAt('before-close', 100));
    harness.relays[0].hardClose();
    await expect(pending).resolves.toMatchObject({
      status: 'complete', events: [eventAt('before-close', 100)], relays: [{ status: 'eose' }],
    });
    harness.pool.destroy();
  });

  test('reports per-relay completion once, with allEnded only for the final relay', async () => {
    const harness = createHarness();
    const oneosed = jest.fn();
    const onclose = jest.fn();
    const pending = harness.pool.query({
      relays: [RELAY_A, RELAY_B], filter: {}, timeoutMs: 1_000, oneosed, onclose,
    });
    await flushPromises();
    harness.relays[0].emitEose();
    await jest.advanceTimersByTimeAsync(500);
    expect(oneosed.mock.calls).toEqual([[RELAY_A.slice(0, -1), false]]);
    await jest.advanceTimersByTimeAsync(500);
    await pending;
    expect(oneosed.mock.calls).toEqual([
      [RELAY_A.slice(0, -1), false], [RELAY_B.slice(0, -1), true],
    ]);
    harness.relays[0].subscriptions[0].params.oneose?.();
    expect(oneosed).toHaveBeenCalledTimes(2);
    expect(onclose).not.toHaveBeenCalled(); // Closing our completed REQ is local cleanup.
    harness.pool.destroy();
  });

  test('reports relay CLOSED before query completion', async () => {
    const harness = createHarness();
    const notifications: string[] = [];
    const pending = harness.pool.query({
      relays: [RELAY_A], filter: {}, timeoutMs: 1_000,
      onclose: (_url, reason) => notifications.push(reason),
      oneosed: (_url, allEnded) => notifications.push(`ended:${allEnded}`),
    });
    await flushPromises();
    harness.relays[0].serverClose('rate-limited: slow down');
    await expect(pending).resolves.toMatchObject({ status: 'complete' });
    expect(notifications).toEqual(['rate-limited: slow down', 'ended:true']);
    harness.pool.destroy();
  });

  test('reports connection errors and still notifies that all relays have ended', async () => {
    const harness = createHarness([new Error('offline')]);
    const onerror = jest.fn();
    const oneosed = jest.fn();
    await expect(harness.pool.query({
      relays: [RELAY_A], filter: {}, timeoutMs: 1_000, onerror, oneosed,
    })).resolves.toMatchObject({ status: 'failed' });
    expect(onerror).toHaveBeenCalledWith(RELAY_A.slice(0, -1), expect.objectContaining({ message: 'offline' }));
    expect(onerror).toHaveBeenCalledTimes(1);
    expect(oneosed).toHaveBeenCalledWith(RELAY_A.slice(0, -1), true);
    harness.pool.destroy();
  });

  test('reports an AUTH error without turning the completed query into failure', async () => {
    const harness = createHarness();
    const notifications: string[] = [];
    const pending = harness.pool.query({
      relays: [RELAY_A], filter: {}, timeoutMs: 1_000,
      signAuth: async () => eventAt('auth', 100),
      onclose: (_url, reason) => notifications.push(reason),
      onerror: (_url, error) => notifications.push(error.message),
      oneosed: (_url, allEnded) => notifications.push(`ended:${allEnded}`),
    });
    await flushPromises();
    jest.spyOn(harness.relays[0], 'auth').mockRejectedValue(new Error('rejected'));
    harness.relays[0].serverClose('auth-required: sign in');
    await expect(pending).resolves.toMatchObject({ status: 'complete' });
    expect(notifications).toEqual(['auth-required: sign in', 'auth failed: rejected', 'ended:true']);
    harness.pool.destroy();
  });

  test('allows an observer to cancel without starting AUTH or reporting EOSE', async () => {
    const harness = createHarness();
    const controller = new AbortController();
    const oneosed = jest.fn();
    const onerror = jest.fn();
    const pending = harness.pool.query({
      relays: [RELAY_A], filter: {}, timeoutMs: 1_000, abort: controller.signal,
      signAuth: async () => eventAt('auth', 100),
      onclose: () => controller.abort(), oneosed, onerror,
    });
    await flushPromises();
    harness.relays[0].serverClose('auth-required: sign in');
    await pending;
    expect(harness.relays[0].authCalls).toBe(0);
    expect(oneosed).not.toHaveBeenCalled();
    expect(onerror).not.toHaveBeenCalled();
    harness.pool.destroy();
  });

  test('observer exceptions cannot prevent AUTH resubscription or query completion', async () => {
    const harness = createHarness();
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const pending = harness.pool.query({
        relays: [RELAY_A], filter: {}, timeoutMs: 1_000,
        signAuth: async () => eventAt('auth', 100),
        onclose: () => { throw new Error('observer failed'); },
        oneosed: () => { throw new Error('observer failed'); },
      });
      await flushPromises();
      harness.relays[0].serverClose('auth-required: sign in');
      await flushPromises();
      expect(harness.relays[0].subscriptions).toHaveLength(2);
      harness.relays[0].emitEose();
      await expect(pending).resolves.toMatchObject({ status: 'complete' });
      expect(log).toHaveBeenCalledTimes(2);
    } finally {
      harness.pool.destroy();
      log.mockRestore();
    }
  });

  test('deduplicates events across relays while preserving per-relay receipts', async () => {
    const harness = createHarness();
    const receipts: string[] = [];
    const query = harness.pool.query({
      relays: [RELAY_A, RELAY_B],
      filter: { kinds: [1] },
      timeoutMs: 1_000,
      onReceived: (url) => receipts.push(url),
    });
    await flushPromises();

    const event = eventAt('same', 100);
    harness.relays[0].emitEvent(event);
    harness.relays[1].emitEvent(event);
    harness.relays[0].emitEose();
    harness.relays[1].emitEose();

    const result = await query;
    expect(result.status).toBe('complete');
    expect(result.events).toEqual([event]);
    expect(receipts).toHaveLength(2);
    expect(result.relays.map((relay) => relay.received)).toEqual([1, 1]);
    harness.pool.destroy();
  });

  test('does not evict a responsive relay that returned only duplicate events', async () => {
    const harness = createHarness();
    const query = harness.pool.query({
      relays: [RELAY_A, RELAY_B],
      filter: { kinds: [1] },
      timeoutMs: 1_000,
    });
    await flushPromises();

    const event = eventAt('same', 100);
    harness.relays[0].emitEvent(event);
    harness.relays[0].hardClose();
    harness.relays[1].emitEvent(event);
    await jest.advanceTimersByTimeAsync(1_000);

    const result = await query;
    expect(result.relays[1]).toMatchObject({ status: 'eose', received: 1 });

    const retry = harness.pool.query({
      relays: [RELAY_B],
      filter: { kinds: [1] },
      timeoutMs: 1_000,
    });
    await flushPromises();

    expect(harness.relays).toHaveLength(2);
    harness.relays[1].emitEose();
    await expect(retry).resolves.toMatchObject({ status: 'complete' });
    harness.pool.destroy();
  });

  test('queues one-shot queries FIFO after a relay reaches its concurrency limit', async () => {
    const harness = createHarness([], 1);
    const first = harness.pool.query({
      relays: [RELAY_A],
      filter: { kinds: [1] },
      timeoutMs: 1_000,
    });
    const second = harness.pool.query({
      relays: [RELAY_A],
      filter: { kinds: [2] },
      timeoutMs: 1_000,
    });
    const third = harness.pool.query({
      relays: [RELAY_A],
      filter: { kinds: [3] },
      timeoutMs: 1_000,
    });

    await flushPromises();
    const relay = harness.relays[0];
    expect(relay.subscriptions).toHaveLength(1);
    expect(relay.subscriptions[0].filters).toEqual([{ kinds: [1] }]);

    relay.emitEose(0);
    await flushPromises();
    expect(relay.subscriptions).toHaveLength(2);
    expect(relay.subscriptions[1].filters).toEqual([{ kinds: [2] }]);

    relay.emitEose(1);
    await flushPromises();
    expect(relay.subscriptions).toHaveLength(3);
    expect(relay.subscriptions[2].filters).toEqual([{ kinds: [3] }]);

    relay.emitEose(2);
    await expect(Promise.all([first, second, third])).resolves.toEqual([
      expect.objectContaining({ status: 'complete' }),
      expect.objectContaining({ status: 'complete' }),
      expect.objectContaining({ status: 'complete' }),
    ]);
    harness.pool.destroy();
  });

  test('allows five one-shot queries per relay by default', async () => {
    const harness = createHarness();
    const queries = Array.from({ length: 6 }, (_, index) =>
      harness.pool.query({
        relays: [RELAY_A],
        filter: { kinds: [index + 1] },
        timeoutMs: 1_000,
      }),
    );

    await flushPromises();
    const relay = harness.relays[0];
    expect(relay.subscriptions).toHaveLength(5);

    relay.emitEose(0);
    await flushPromises();
    expect(relay.subscriptions).toHaveLength(6);
    for (let index = 1; index < 6; index += 1) relay.emitEose(index);

    await expect(Promise.all(queries)).resolves.toEqual(
      Array.from({ length: 6 }, () => expect.objectContaining({ status: 'complete' })),
    );
    harness.pool.destroy();
  });

  test('applies the one-shot query limit independently to each relay', async () => {
    const harness = createHarness([], 1);
    const first = harness.pool.query({
      relays: [RELAY_A],
      filter: { kinds: [1] },
      timeoutMs: 1_000,
    });
    const second = harness.pool.query({
      relays: [RELAY_B],
      filter: { kinds: [2] },
      timeoutMs: 1_000,
    });

    await flushPromises();
    expect(harness.relays).toHaveLength(2);
    expect(harness.relays[0].subscriptions).toHaveLength(1);
    expect(harness.relays[1].subscriptions).toHaveLength(1);

    harness.relays[0].emitEose();
    harness.relays[1].emitEose();
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ status: 'complete' }),
      expect.objectContaining({ status: 'complete' }),
    ]);
    harness.pool.destroy();
  });

  test('starts a one-shot timeout only after the query leaves the relay queue', async () => {
    const harness = createHarness([], 1);
    const blocker = harness.pool.query({
      relays: [RELAY_A],
      filter: { kinds: [1] },
      timeoutMs: 5_000,
    });
    const queued = harness.pool.query({
      relays: [RELAY_A],
      filter: { kinds: [2] },
      timeoutMs: 1_000,
    });

    await flushPromises();
    const relay = harness.relays[0];
    await jest.advanceTimersByTimeAsync(2_000);
    expect(relay.subscriptions).toHaveLength(1);

    relay.emitEose(0);
    await flushPromises();
    expect(relay.subscriptions).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(999);
    expect(relay.subscriptions[1].subscription.closed).toBe(false);
    await jest.advanceTimersByTimeAsync(1);

    await expect(blocker).resolves.toMatchObject({ status: 'complete' });
    await expect(queued).resolves.toMatchObject({ status: 'complete' });
    harness.pool.destroy();
  });

  test('aborts active and queued one-shot queries without waiting for their deadlines', async () => {
    const harness = createHarness([], 1);
    const activeController = new AbortController();
    const queuedController = new AbortController();
    const active = harness.pool.query({
      relays: [RELAY_A],
      filter: { kinds: [1] },
      timeoutMs: 60_000,
      abort: activeController.signal,
    });
    const queued = harness.pool.query({
      relays: [RELAY_A],
      filter: { kinds: [2] },
      timeoutMs: 60_000,
      abort: queuedController.signal,
    });

    await flushPromises();
    expect(harness.relays[0].subscriptions).toHaveLength(1);

    queuedController.abort();
    const queuedResult = await queued;

    expect(queuedResult.relays[0]).toMatchObject({ status: 'closed', reason: 'query aborted' });
    expect(harness.relays[0].subscriptions[0].subscription.closed).toBe(false);

    activeController.abort();
    const activeResult = await active;

    expect(activeResult.relays[0]).toMatchObject({ status: 'closed', reason: 'query aborted' });
    expect(harness.relays[0].subscriptions).toHaveLength(1);
    expect(harness.relays[0].subscriptions[0].subscription.closed).toBe(true);
    harness.pool.destroy();
  });

  test('resolves queued one-shot work as closed when the pool is destroyed', async () => {
    const harness = createHarness([], 1);
    const active = harness.pool.query({
      relays: [RELAY_A],
      filter: { kinds: [1] },
      timeoutMs: 5_000,
    });
    const queued = harness.pool.query({
      relays: [RELAY_A],
      filter: { kinds: [2] },
      timeoutMs: 5_000,
    });

    await flushPromises();
    expect(harness.relays[0].subscriptions).toHaveLength(1);
    harness.pool.destroy();

    await expect(active).resolves.toMatchObject({ status: 'failed' });
    await expect(queued).resolves.toMatchObject({ status: 'failed' });
    expect(harness.relays[0].subscriptions).toHaveLength(1);
  });
});

function createHarness(
  connectResults: (Error | null)[] = [],
  maxConcurrentQueriesPerRelay?: number,
) {
  const relays: FakeRelay[] = [];
  const pool = new ManagedRelayPool({
    verifyEvent: () => true,
    observeLifecycle: false,
    random: () => 0.5,
    maxConcurrentQueriesPerRelay,
    relayFactory: (url: string, _options: AbstractRelayConstructorOptions) => {
      const relay = new FakeRelay(url, connectResults[relays.length] ?? null);
      relays.push(relay);
      return relay as unknown as AbstractRelay;
    },
  });
  return { pool, relays };
}

type FakeSubscriptionRecord = {
  filters: Filter[];
  params: Partial<SubscriptionParams>;
  subscription: Subscription;
};

class FakeRelay {
  connected = false;
  pingFrequency = 29_000;
  _onmessage(_event: MessageEvent): void {}
  onclose: (() => void) | null = null;
  publishTimeout = 4_400;
  authCalls = 0;
  readonly subscriptions: FakeSubscriptionRecord[] = [];

  constructor(
    readonly url: string,
    private readonly connectError: Error | null,
  ) {}

  async connect(): Promise<void> {
    if (this.connectError) throw this.connectError;
    this.connected = true;
  }

  subscribe(filters: Filter[], params: Partial<SubscriptionParams>): Subscription {
    let closed = false;
    const subscription = {
      eosed: false,
      get closed() {
        return closed;
      },
      close: (reason = 'closed by caller') => {
        if (closed) return;
        closed = true;
        params.onclose?.(reason);
      },
    } as unknown as Subscription;
    this.subscriptions.push({ filters, params, subscription });
    return subscription;
  }

  async publish(): Promise<string> {
    return 'saved';
  }

  async auth(): Promise<string> {
    this.authCalls += 1;
    return 'authenticated';
  }

  close(): void {
    this.connected = false;
    this.onclose?.();
    for (const record of this.subscriptions) {
      if (!record.subscription.closed) record.subscription.close('relay connection closed by us');
    }
  }

  hardClose(): void {
    this.connected = false;
    this.onclose?.();
    for (const record of this.subscriptions) {
      if (!record.subscription.closed) record.subscription.close('relay connection closed');
    }
  }

  serverClose(reason: string, subscriptionIndex = this.subscriptions.length - 1): void {
    const record = this.subscriptions[subscriptionIndex];
    record?.subscription.close(reason);
  }

  emitEvent(event: Event, subscriptionIndex = this.subscriptions.length - 1): void {
    const record = this.subscriptions[subscriptionIndex];
    if (!record || record.subscription.closed) return;
    this._onmessage({ data: 'EVENT' } as MessageEvent);
    const duplicate = record.params.alreadyHaveEvent?.(event.id) === true;
    record.params.receivedEvent?.(this as unknown as AbstractRelay, event.id);
    if (!duplicate) record.params.onevent?.(event);
  }

  emitEose(subscriptionIndex = this.subscriptions.length - 1): void {
    const record = this.subscriptions[subscriptionIndex];
    if (!record || record.subscription.closed) return;
    this._onmessage({ data: 'EOSE' } as MessageEvent);
    record.subscription.eosed = true;
    record.params.oneose?.();
  }
}

function eventAt(id: string, createdAt: number): Event {
  return {
    id: id.padEnd(64, '0'),
    pubkey: 'a'.repeat(64),
    created_at: createdAt,
    kind: 1,
    tags: [],
    content: '',
    sig: 'b'.repeat(128),
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
