import type { Event, EventTemplate, Filter, VerifiedEvent } from 'nostr-tools';
import {
  AbstractRelay,
  SendingOnClosedConnection,
  type AbstractRelayConstructorOptions,
  type Subscription,
} from 'nostr-tools/abstract-relay';
import {
  AbstractSimplePool,
  type SubCloser,
  type SubscribeManyParams,
} from 'nostr-tools/abstract-pool';

import { scheduleBackgroundDeadline } from '@/lib/background-deadline';
import { IS_ANDROID } from '@/lib/platform';
import { normalizeRelayUrl } from '@/lib/nostr/relay-url';
import { platform, type AppStateStatus, type NetworkStateSnapshot } from '@/platform';

import { RelayQueryError } from './relay-query-error';

const CONNECTION_TIMEOUT_MS = 5_000;
const AUTH_TIMEOUT_MS = 8_000;
const RELAY_IDLE_TIMEOUT_MS = 30_000;
const LONG_LIVED_EOSE_TIMEOUT_MS = 2_147_000_000;
const LIVE_DEDUP_LIMIT = 8_192;
const DEFAULT_MAX_CONCURRENT_QUERIES_PER_RELAY = 5;
const RETRY_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 20_000, 30_000, 60_000];
const BACKGROUND_RETRY_BACKOFF_MS = [...RETRY_BACKOFF_MS, 120_000, 300_000];
const ANDROID_PING_INTERVAL_MS = 60_000;
const HEALTH_RESPONSE_MAX_AGE_MS = 90_000;

export type SignAuth = (authEvent: EventTemplate) => Promise<Event>;

export type RelaySubscriptionStatus = 'connecting' | 'degraded' | 'connected';

type ManagedSubscribeBase = QueryObservers & {
  label?: string;
  relays: string[];
  onEvent: (event: Event, relayUrl: string) => void;
  /** Initial read ended on every relay; the subscription stays active until closed. */
  onEose?: () => void;
  /** Initial per-relay outcomes, also delivered if closed before the read ends. */
  onEnd?: (results: QueryRelayResult[]) => void;
  timeoutMs?: number;
  abort?: AbortSignal;
  onInvalidEvent?: (event: unknown) => void;
  onReceived?: (relayUrl: string, id: string) => void;
  onReceivedRelay?: (relay: AbstractRelay, id: string) => void;
  onStatusChange?: (status: RelaySubscriptionStatus) => void;
  onRelayClose?: (relayUrl: string, reason: string) => void;
  alreadyHaveEvent?: (id: string) => boolean;
  signAuth?: SignAuth;
};

export type ManagedSubscribeOptions = ManagedSubscribeBase &
  ({ filter: Filter; filters?: never } | { filter?: never; filters: Filter[] });

export type QueryRelayStatus = 'eose' | 'connection-failed' | 'closed';

export type QueryRelayResult = {
  url: string;
  status: QueryRelayStatus;
  received: number;
  reason?: string;
};

export type QueryStatus = 'complete' | 'failed';

export type QueryObservers = {
  /** Relay-originated closure, including auth-required; excludes local cleanup. */
  onclose?: (relayUrl: string, reason: string) => void;
  /** Connection or AUTH error. AUTH errors still end the REQ as EOSE. */
  onerror?: (relayUrl: string, error: Error) => void;
  /** Once per settled relay, including failed connections. Cancellation is excluded.
   * allEnded means every target settled, not that every target succeeded. */
  oneosed?: (relayUrl: string, allEnded: boolean) => void;
};

type ManagedQueryBase = QueryObservers & {
  relays: string[];
  timeoutMs: number;
  onEvent?: (event: Event) => void;
  onReceived?: (relayUrl: string, id: string) => void;
  signAuth?: SignAuth;
  abort?: AbortSignal;
};

export type ManagedQueryOptions = ManagedQueryBase &
  ({ filter: Filter; filters?: never } | { filter?: never; filters: Filter[] });

export type ManagedQueryResult = {
  events: Event[];
  status: QueryStatus;
  relays: QueryRelayResult[];
};

export type ManagedPublishOptions = {
  url: string;
  event: Event;
  signAuth?: SignAuth;
  timeoutMs?: number;
  abort?: AbortSignal;
};

export type ManagedPublishOutcome = { ok: true; message?: string } | { ok: false; reason: string };

type RelayFactory = (url: string, options: AbstractRelayConstructorOptions) => AbstractRelay;

export type ManagedRelayPoolOptions = {
  verifyEvent: (event: Event, relayUrl: string) => boolean;
  relayFactory?: RelayFactory;
  observeLifecycle?: boolean;
  random?: () => number;
  maxConcurrentQueriesPerRelay?: number;
};

type ManagedConnection = {
  url: string;
  relay: AbstractRelay | null;
  connectPromise: Promise<AbstractRelay> | null;
  connectAbort: AbortController | null;
  generation: number;
  retryAttempt: number;
  retryTimer: (() => void) | null;
  lastReceivedAt: number | null;
};

type RetrySchedule = {
  timer: () => void;
};

type PhysicalSubscription = {
  subscription: Subscription;
  generation: number;
};

type LogicalSubscription = {
  id: string;
  urls: string[];
  options: ManagedSubscribeBase & { filters: Filter[] };
  physical: Map<string, PhysicalSubscription>;
  authAttempts: Map<string, { generation: number; count: number }>;
  retryAttempts: Map<string, number>;
  retryTimers: Map<string, RetrySchedule>;
  knownIds: BoundedIdSet;
  closed: boolean;
  eoseNotified: boolean;
  lastStatus: RelaySubscriptionStatus | null;
  reads: Map<string, { received: number; timer: ReturnType<typeof setTimeout> | null; result?: QueryRelayResult }>;
  ended: number;
  abortCleanup?: () => void;
};

type QueryRelayContext = {
  subscribe: (options: ManagedSubscribeOptions) => () => void;
  url: string;
  options: ManagedQueryBase & { filters: Filter[] };
  events: Map<string, Event>;
};

type QueuedRelayQuery = {
  context: QueryRelayContext;
  generation: number;
  resolve: (result: QueryRelayResult) => void;
  cancelled: boolean;
  abortCleanup: (() => void) | null;
};

type RelayQueryQueue = {
  entries: QueuedRelayQuery[];
  head: number;
};

/**
 * Owns relay connection and subscription lifecycle while delegating Nostr wire
 * parsing, validation hooks, NIP-42 AUTH, and publish acknowledgement matching
 * to nostr-tools' lower-level AbstractRelay.
 */
export class ManagedRelayPool {
  private readonly verifyEvent: (event: Event, relayUrl: string) => boolean;
  private readonly relayFactory: RelayFactory;
  private readonly random: () => number;
  private readonly maxConcurrentQueriesPerRelay: number;
  private readonly connections = new Map<string, ManagedConnection>();
  private readonly subscriptions = new Map<string, LogicalSubscription>();
  private readonly subscriptionIdsByRelay = new Map<string, Set<string>>();
  private readonly activeQueriesByRelay = new Map<string, number>();
  private readonly queuedQueriesByRelay = new Map<string, RelayQueryQueue>();
  private readonly bunkerPool: ManagedAbstractPoolAdapter;
  private subscriptionSerial = 0;
  private queryGeneration = 0;
  private networkAvailable: boolean | undefined;
  private networkSignature: string | null = null;
  private appState: AppStateStatus = platform.appState.currentState();

  constructor(options: ManagedRelayPoolOptions) {
    this.verifyEvent = options.verifyEvent;
    this.relayFactory =
      options.relayFactory ?? ((url, relayOptions) => new AbstractRelay(url, relayOptions));
    this.random = options.random ?? Math.random;
    this.maxConcurrentQueriesPerRelay = normalizeQueryConcurrency(
      options.maxConcurrentQueriesPerRelay,
    );
    this.bunkerPool = new ManagedAbstractPoolAdapter(this, this.verifyEvent);

    if (options.observeLifecycle !== false) this.observeLifecycle();
  }

  get underlyingPool(): AbstractSimplePool {
    return this.bunkerPool;
  }

  subscribe(options: ManagedSubscribeOptions): () => void {
    const urls = normalizeRelayUrls(options.relays);
    const filters = normalizeSubscriptionFilters(options);
    const id = `managed:${++this.subscriptionSerial}`;
    const logical: LogicalSubscription = {
      id,
      urls,
      options: { ...options, filters, relays: urls },
      physical: new Map(),
      authAttempts: new Map(),
      retryAttempts: new Map(),
      retryTimers: new Map(),
      knownIds: new BoundedIdSet(LIVE_DEDUP_LIMIT),
      closed: false,
      eoseNotified: false,
      lastStatus: null,
      reads: new Map(urls.map((url) => [url, { received: 0, timer: null }])),
      ended: 0,
    };

    this.subscriptions.set(id, logical);
    if (options.abort) {
      const abort = () => this.closeLogicalSubscription(logical);
      options.abort.addEventListener('abort', abort, { once: true });
      logical.abortCleanup = () => options.abort?.removeEventListener('abort', abort);
      if (options.abort.aborted) {
        queueMicrotask(abort);
        return abort;
      }
    }
    if (urls.length === 0) {
      queueMicrotask(() => {
        if (logical.closed) return;
        logical.eoseNotified = true;
        notifyQueryObserver(() => options.onEose?.());
        notifyQueryObserver(() => options.onEnd?.([]));
      });
    }
    for (const url of urls) {
      let ids = this.subscriptionIdsByRelay.get(url);
      if (!ids) {
        ids = new Set();
        this.subscriptionIdsByRelay.set(url, ids);
      }
      ids.add(id);
      const connectionTimeout = Math.min(CONNECTION_TIMEOUT_MS, options.timeoutMs ?? 6_000);
      const read = logical.reads.get(url)!;
      read.timer = setTimeout(() => {
        notifyQueryObserver(() => options.onerror?.(url, new Error('connection timed out')));
        this.settleSubscriptionRead(logical, url, 'connection-failed', 'connection timed out');
      }, connectionTimeout);
      void this.ensureRelay(url, connectionTimeout)
        .then((relay) => {
          const connection = this.connections.get(url);
          if (
            logical.closed ||
            connection?.relay !== relay ||
            !relay.connected
          ) {
            return;
          }
          // A query or publish may already own this connected socket, in which
          // case ensureRelay does not run its new-connection attach pass. Attach
          // only the logical subscription registered by this call: scanning all
          // demand here could resurrect a REQ the relay permanently rejected.
          this.attachLogicalSubscription(
            logical,
            url,
            relay,
            connection.generation,
          );
        })
        .catch((error) => {
          if (logical.closed) return;
          notifyQueryObserver(() => options.onerror?.(url, new Error(errorMessage(error))));
          this.settleSubscriptionRead(logical, url, 'connection-failed', errorMessage(error));
          // The subscription remains registered until its owner closes it.
        });
    }
    this.notifySubscriptionStatus(logical);

    return () => this.closeLogicalSubscription(logical);
  }

  async query(
    options: ManagedQueryOptions,
    subscribe: (options: ManagedSubscribeOptions) => () => void = (options) => this.subscribe(options),
  ): Promise<ManagedQueryResult> {
    const urls = normalizeRelayUrls(options.relays);
    if (urls.length === 0) return { events: [], status: 'failed', relays: [] };

    const context: ManagedQueryBase & { filters: Filter[] } = {
      ...options,
      filters: normalizeQueryFilters(options),
    };
    const events = new Map<string, Event>();
    const generation = this.queryGeneration;
    let ended = 0;
    const relays = await Promise.all(
      urls.map(async (url) => {
        const result = await this.enqueueRelayQuery({ url, options: context, events, subscribe });
        ended += 1;
        if (!options.abort?.aborted && generation === this.queryGeneration && result.status !== 'closed') {
          notifyQueryObserver(() => options.oneosed?.(url, ended === urls.length));
        }
        return result;
      }),
    );
    return {
      events: Array.from(events.values()),
      status: relays.some((relay) => relay.status === 'eose') ? 'complete' : 'failed',
      relays,
    };
  }

  async publishToRelay(options: ManagedPublishOptions): Promise<ManagedPublishOutcome> {
    const url = normalizeRelayUrl(options.url);
    let relay: AbstractRelay;
    try {
      relay = await abortable(
        this.ensureRelay(url, options.timeoutMs ?? CONNECTION_TIMEOUT_MS),
        options.abort,
      );
    } catch (error) {
      return { ok: false, reason: `cannot connect: ${errorMessage(error)}` };
    }

    let hasAuthed = false;
    const attempt = async (): Promise<ManagedPublishOutcome> => {
      try {
        const message = await abortable(
          this.publishWithTimeout(relay, options.event, options.timeoutMs),
          options.abort,
        );
        return { ok: true, message };
      } catch (error) {
        const reason = errorMessage(error);
        if (!hasAuthed && reason.startsWith('auth-required') && options.signAuth) {
          hasAuthed = true;
          try {
            await this.authenticate(relay, options.signAuth);
            return await attempt();
          } catch (authError) {
            return { ok: false, reason: `auth failed: ${errorMessage(authError)}` };
          }
        }
        if (error instanceof SendingOnClosedConnection || reason === 'publish timed out') {
          this.recycleIfCurrent(url, relay);
        }
        return { ok: false, reason };
      }
    };

    return attempt();
  }

  async ensureRelay(
    relayUrl: string,
    timeoutMs: number = CONNECTION_TIMEOUT_MS,
  ): Promise<AbstractRelay> {
    const url = normalizeRelayUrl(relayUrl);
    if (this.networkAvailable === false) throw new Error('network unavailable');

    const connection = this.getConnection(url);
    if (connection.relay?.connected) return connection.relay;
    if (connection.connectPromise) return connection.connectPromise;

    this.clearRetryTimer(connection);
    const generation = ++connection.generation;
    const connectAbort = new AbortController();
    const relay = this.relayFactory(url, {
      verifyEvent: this.verifyEvent,
      enablePing: true,
      enableReconnect: false,
      idleTimeout: RELAY_IDLE_TIMEOUT_MS,
    });
    // Configure before connect: nostr-tools captures the interval on socket open.
    if (IS_ANDROID) relay.pingFrequency = ANDROID_PING_INTERVAL_MS;
    const onMessage = relay._onmessage.bind(relay);
    relay._onmessage = (event) => {
      if (connection.generation === generation && connection.relay === relay) {
        connection.lastReceivedAt = Date.now();
      }
      onMessage(event);
    };
    connection.lastReceivedAt = null;
    connection.relay = relay;
    connection.connectAbort = connectAbort;
    relay.onclose = () => this.handleRelayClose(connection, relay, generation);

    const pending = (async () => {
      try {
        await relay.connect({ timeout: timeoutMs, abort: connectAbort.signal });
        if (connection.generation !== generation || connection.relay !== relay) {
          relay.onclose = null;
          relay.close();
          throw new Error('stale relay connection');
        }
        connection.retryAttempt = 0;
        this.attachSubscriptionsForRelay(url, relay, generation);
        return relay;
      } catch (error) {
        if (connection.generation === generation && connection.relay === relay) {
          connection.relay = null;
          this.scheduleRetry(connection);
          this.notifySubscriptionsForRelay(url);
        }
        throw error;
      } finally {
        if (connection.generation === generation) {
          connection.connectPromise = null;
          connection.connectAbort = null;
        }
      }
    })();
    connection.connectPromise = pending;
    return pending;
  }

  closeRelays(relays: string[]): void {
    for (const url of normalizeRelayUrls(relays)) {
      const connection = this.connections.get(url);
      if (connection) this.closeConnection(connection, false);
    }
  }

  listConnectionStatus(): Map<string, boolean> {
    const result = new Map<string, boolean>();
    for (const [url, connection] of this.connections) {
      result.set(url, connection.relay?.connected === true);
    }
    return result;
  }

  destroy(): void {
    this.queryGeneration += 1;
    for (const [url, queue] of this.queuedQueriesByRelay) {
      for (let index = queue.head; index < queue.entries.length; index += 1) {
        const entry = queue.entries[index];
        entry.abortCleanup?.();
        entry.resolve({
          url,
          status: 'closed',
          received: 0,
          reason: 'relay pool destroyed',
        });
      }
    }
    this.queuedQueriesByRelay.clear();
    for (const subscription of Array.from(this.subscriptions.values())) {
      this.closeLogicalSubscription(subscription);
    }
    for (const connection of this.connections.values()) this.closeConnection(connection, false);
    this.connections.clear();
    this.subscriptionIdsByRelay.clear();
  }

  /** Test and lifecycle hook: immediately replace every demanded connection. */
  recoverConnections(): void {
    if (this.networkAvailable === false) return;
    for (const url of this.subscriptionIdsByRelay.keys()) this.recoverRelay(url);
  }

  /** A socket flag alone cannot prove liveness. Require an actual EOSE for
   * every current physical subscription and recent inbound traffic (including
   * nostr-tools heartbeats), so a suspended or half-open socket cannot hide a poll. */
  hasHealthySubscription(label: string, now = Date.now()): boolean {
    for (const logical of this.subscriptions.values()) {
      if (logical.options.label !== label || logical.closed || logical.urls.length === 0) continue;
      return logical.urls.every((url) => {
        const connection = this.connections.get(url);
        const physical = logical.physical.get(url);
        return !!(
          connection?.relay?.connected && !connection.connectPromise &&
          physical && physical.generation === connection.generation &&
          !physical.subscription.closed && physical.subscription.eosed &&
          !logical.retryTimers.has(url) && connection.lastReceivedAt !== null &&
          now - connection.lastReceivedAt >= 0 &&
          now - connection.lastReceivedAt <= HEALTH_RESPONSE_MAX_AGE_MS
        );
      });
    }
    return false;
  }

  private retryDelay(attempt: number): number {
    const backoff = IS_ANDROID && this.appState !== 'active'
      ? BACKGROUND_RETRY_BACKOFF_MS : RETRY_BACKOFF_MS;
    return Math.round(backoff[Math.min(attempt, backoff.length - 1)] * (0.8 + this.random() * 0.4));
  }

  private observeLifecycle(): void {
    platform.appState.addChangeListener((nextState) => {
      const previous = this.appState;
      this.appState = nextState;
      if (nextState === 'active' && previous !== 'active') this.recoverConnections();
    });

    platform.networkState.addStateListener((state) => this.handleNetworkState(state));
    void platform.networkState
      .getState()
      .then((state) => this.handleNetworkState(state, true))
      .catch(() => {
        // The socket remains the source of truth when the OS network hint is
        // unavailable.
      });
  }

  private handleNetworkState(state: NetworkStateSnapshot, initial = false): void {
    const available = state.isConnected !== false && state.isInternetReachable !== false;
    const signature = `${state.type ?? 'unknown'}:${String(state.isConnected)}:${String(state.isInternetReachable)}`;
    const previousAvailable = this.networkAvailable;
    const previousSignature = this.networkSignature;
    this.networkAvailable = available;
    this.networkSignature = signature;

    if (!available) {
      for (const connection of this.connections.values()) this.closeConnection(connection, false);
      return;
    }

    if (!initial && (previousAvailable === false || previousSignature !== signature)) {
      this.recoverConnections();
    }
  }

  private getConnection(url: string): ManagedConnection {
    let connection = this.connections.get(url);
    if (!connection) {
      connection = {
        url,
        relay: null,
        connectPromise: null,
        connectAbort: null,
        generation: 0,
        retryAttempt: 0,
        retryTimer: null,
        lastReceivedAt: null,
      };
      this.connections.set(url, connection);
    }
    return connection;
  }

  private handleRelayClose(
    connection: ManagedConnection,
    relay: AbstractRelay,
    generation: number,
  ): void {
    if (connection.generation !== generation || connection.relay !== relay) return;
    connection.relay = null;
    connection.connectPromise = null;
    connection.connectAbort = null;
    this.notifySubscriptionsForRelay(connection.url);
    this.scheduleRetry(connection);
  }

  private scheduleRetry(connection: ManagedConnection): void {
    if (
      connection.retryTimer ||
      this.networkAvailable === false ||
      !this.hasSubscriptionDemand(connection.url)
    ) {
      return;
    }

    const delay = this.retryDelay(connection.retryAttempt++);
    connection.retryTimer = scheduleBackgroundDeadline(() => {
      connection.retryTimer = null;
      if (!this.hasSubscriptionDemand(connection.url)) return;
      void this.ensureRelay(connection.url).catch(() => {
        // ensureRelay schedules the next backoff slot.
      });
    }, delay);
  }

  private clearRetryTimer(connection: ManagedConnection): void {
    connection.retryTimer?.();
    connection.retryTimer = null;
  }

  private recoverRelay(url: string): void {
    const connection = this.getConnection(url);
    connection.retryAttempt = 0;
    this.closeConnection(connection, false);
    if (!this.hasSubscriptionDemand(url)) return;
    void this.ensureRelay(url).catch(() => {
      // The durable demand remains and will enter backoff.
    });
  }

  private recycleIfCurrent(url: string, relay: AbstractRelay): void {
    const connection = this.connections.get(url);
    if (!connection || connection.relay !== relay) return;
    this.closeConnection(connection, false);
    if (this.hasSubscriptionDemand(url)) {
      void this.ensureRelay(url).catch(() => {
        // The durable demand remains and will enter backoff.
      });
    }
  }

  private closeConnection(connection: ManagedConnection, reconnect: boolean): void {
    this.clearRetryTimer(connection);
    const relay = connection.relay;
    connection.generation += 1;
    connection.relay = null;
    connection.connectPromise = null;
    connection.connectAbort?.abort();
    connection.connectAbort = null;
    if (relay) {
      relay.onclose = null;
      relay.close();
    }
    this.notifySubscriptionsForRelay(connection.url);
    if (reconnect && this.hasSubscriptionDemand(connection.url)) {
      void this.ensureRelay(connection.url).catch(() => {});
    }
  }

  private hasSubscriptionDemand(url: string): boolean {
    return (this.subscriptionIdsByRelay.get(url)?.size ?? 0) > 0;
  }

  private attachSubscriptionsForRelay(
    url: string,
    relay: AbstractRelay,
    generation: number,
  ): void {
    const ids = this.subscriptionIdsByRelay.get(url);
    if (!ids) return;
    for (const id of ids) {
      const logical = this.subscriptions.get(id);
      if (logical) this.attachLogicalSubscription(logical, url, relay, generation);
    }
  }

  private attachLogicalSubscription(
    logical: LogicalSubscription,
    url: string,
    relay: AbstractRelay,
    generation: number,
  ): void {
    if (logical.closed) return;
    const existing = logical.physical.get(url);
    if (existing?.generation === generation && !existing.subscription.closed) return;
    this.clearSubscriptionRetryTimer(logical, url);

    const read = logical.reads.get(url)!;
    if (!read.result) {
      if (read.timer) clearTimeout(read.timer);
      read.timer = setTimeout(() => {
        this.settleSubscriptionRead(logical, url, 'eose', 'query timed out');
      }, logical.options.timeoutMs ?? 6_000);
    }
    const physical = {} as PhysicalSubscription;
    const subscription = relay.subscribe(logical.options.filters.map(cloneFilter), {
      label: logical.options.label,
      alreadyHaveEvent: (id) =>
        logical.options.alreadyHaveEvent?.(id) === true || logical.knownIds.has(id),
      receivedEvent: (sourceRelay, id) => {
        if (logical.closed || logical.physical.get(url) !== physical) return;
        read.received += 1;
        logical.options.onReceived?.(url, id);
        logical.options.onReceivedRelay?.(sourceRelay, id);
      },
      onevent: (event) => {
        if (logical.closed || logical.physical.get(url) !== physical) return;
        logical.retryAttempts.delete(url);
        logical.knownIds.add(event.id);
        logical.options.onEvent(event, url);
      },
      oninvalidevent: logical.options.onInvalidEvent,
      oneose: () => {
        if (logical.closed || logical.physical.get(url) !== physical) return;
        logical.retryAttempts.delete(url);
        this.settleSubscriptionRead(logical, url, 'eose');
      },
      onclose: (reason) => this.handlePhysicalSubscriptionClose(logical, url, physical, reason),
      // The shared initial-read timer owns timeout completion and AUTH resets.
      eoseTimeout: LONG_LIVED_EOSE_TIMEOUT_MS,
    });
    physical.subscription = subscription;
    physical.generation = generation;
    logical.physical.set(url, physical);
    this.notifySubscriptionStatus(logical);
  }

  private handlePhysicalSubscriptionClose(
    logical: LogicalSubscription,
    url: string,
    physical: PhysicalSubscription,
    reason: string,
  ): void {
    if (logical.physical.get(url) !== physical) return;
    logical.physical.delete(url);
    this.notifySubscriptionStatus(logical);
    if (logical.closed || reason === 'relay connection closed by us') return;
    notifyQueryObserver(() => logical.options.onclose?.(url, reason));
    if (logical.closed) return;

    const connection = this.connections.get(url);
    const relay = connection?.relay;
    if (
      reason.startsWith('auth-required') &&
      logical.options.signAuth &&
      relay?.connected &&
      connection?.generation === physical.generation
    ) {
      const previous = logical.authAttempts.get(url);
      const count = previous?.generation === physical.generation ? previous.count : 0;
      if (count < 1) {
        logical.authAttempts.set(url, { generation: physical.generation, count: count + 1 });
        const read = logical.reads.get(url)!;
        if (read.timer) clearTimeout(read.timer);
        read.timer = null;
        void this.authenticate(relay, logical.options.signAuth)
          .then(() => {
            const current = this.connections.get(url);
            if (
              !logical.closed &&
              current?.relay === relay &&
              current.generation === physical.generation
            ) {
              this.attachLogicalSubscription(logical, url, relay, physical.generation);
            }
          })
          .catch((error) => {
            if (logical.closed || this.connections.get(url)?.generation !== physical.generation) return;
            const reason = `auth failed: ${errorMessage(error)}`;
            notifyQueryObserver(() => logical.options.onerror?.(url, new Error(reason)));
            this.settleSubscriptionRead(logical, url, 'eose', reason);
            if (logical.closed) return;
            logical.options.onRelayClose?.(url, reason);
            logical.authAttempts.delete(url);
            this.scheduleSubscriptionRetry(logical, url);
          });
        return;
      }
    }

    if (reason.startsWith('auth-required')) {
      const detail = logical.options.signAuth ? 'AUTH was not accepted' : 'AUTH signer unavailable';
      notifyQueryObserver(() => logical.options.onerror?.(url, new Error(`${detail}: ${reason}`)));
    }
    this.settleSubscriptionRead(logical, url, 'eose', reason);
    if (logical.closed) return;
    if (reason.startsWith('auth-required')) {
      logical.options.onRelayClose?.(url, reason);
      return;
    }

    if (!reason.startsWith('relay connection')) {
      logical.options.onRelayClose?.(url, reason);
      if (isRetryableSubscriptionClose(reason)) this.scheduleSubscriptionRetry(logical, url);
    }
  }

  private settleSubscriptionRead(
    logical: LogicalSubscription,
    url: string,
    status: QueryRelayStatus,
    reason?: string,
  ): void {
    const read = logical.reads.get(url);
    if (logical.closed || !read || read.result) return;
    if (read.timer) clearTimeout(read.timer);
    read.timer = null;
    read.result = { url, status, received: read.received, reason };
    const allEnded = ++logical.ended === logical.urls.length;
    logical.eoseNotified = allEnded;
    notifyQueryObserver(() => logical.options.oneosed?.(url, allEnded));
    if (allEnded) {
      notifyQueryObserver(() => logical.options.onEose?.());
      notifyQueryObserver(() => logical.options.onEnd?.(
        logical.urls.map((url) => logical.reads.get(url)!.result!),
      ));
    }
  }

  private scheduleSubscriptionRetry(logical: LogicalSubscription, url: string): void {
    if (logical.closed || logical.retryTimers.has(url)) return;
    const attempt = logical.retryAttempts.get(url) ?? 0;
    logical.retryAttempts.set(url, attempt + 1);
    const delay = this.retryDelay(attempt);
    const handle = scheduleBackgroundDeadline(() => {
      const retry = logical.retryTimers.get(url);
      if (retry?.timer !== handle) return;
      logical.retryTimers.delete(url);
      if (logical.closed) return;
      const connection = this.connections.get(url);
      if (connection?.relay?.connected) {
        this.attachLogicalSubscription(logical, url, connection.relay, connection.generation);
        return;
      }
      void this.ensureRelay(url).catch(() => {
        // Connection-level demand owns the next retry when the socket is down.
      });
    }, delay);
    logical.retryTimers.set(url, { timer: handle });
  }

  private clearSubscriptionRetryTimer(logical: LogicalSubscription, url: string): void {
    const retry = logical.retryTimers.get(url);
    if (!retry) return;
    retry.timer();
    logical.retryTimers.delete(url);
  }

  private closeLogicalSubscription(logical: LogicalSubscription): void {
    if (logical.closed) return;
    logical.closed = true;
    logical.abortCleanup?.();
    for (const read of logical.reads.values()) {
      if (read.timer) clearTimeout(read.timer);
      read.timer = null;
    }
    this.subscriptions.delete(logical.id);
    for (const retry of logical.retryTimers.values()) retry.timer();
    logical.retryTimers.clear();
    for (const url of logical.urls) {
      const ids = this.subscriptionIdsByRelay.get(url);
      ids?.delete(logical.id);
      if (ids?.size === 0) {
        this.subscriptionIdsByRelay.delete(url);
        const connection = this.connections.get(url);
        if (connection) this.clearRetryTimer(connection);
      }
    }
    for (const physical of logical.physical.values()) {
      physical.subscription.close('closed by caller');
    }
    logical.physical.clear();
    if (!logical.eoseNotified) {
      logical.eoseNotified = true;
      notifyQueryObserver(() => logical.options.onEnd?.(logical.urls.map((url) => {
        const read = logical.reads.get(url)!;
        return read.result ?? { url, status: 'closed', received: read.received, reason: 'query aborted' };
      })));
    }
  }

  private notifySubscriptionsForRelay(url: string): void {
    const ids = this.subscriptionIdsByRelay.get(url);
    if (!ids) return;
    for (const id of ids) {
      const logical = this.subscriptions.get(id);
      if (logical) this.notifySubscriptionStatus(logical);
    }
  }

  private notifySubscriptionStatus(logical: LogicalSubscription): void {
    if (logical.closed) return;
    let connected = 0;
    for (const url of logical.urls) {
      const physical = logical.physical.get(url);
      const connection = this.connections.get(url);
      if (
        physical &&
        connection?.relay?.connected &&
        physical.generation === connection.generation
      ) {
        connected += 1;
      }
    }
    const status: RelaySubscriptionStatus =
      connected === 0
        ? 'connecting'
        : connected === logical.urls.length
          ? 'connected'
          : 'degraded';
    if (status === logical.lastStatus) return;
    logical.lastStatus = status;
    logical.options.onStatusChange?.(status);
  }

  private enqueueRelayQuery(context: QueryRelayContext): Promise<QueryRelayResult> {
    if (context.options.abort?.aborted) {
      return Promise.resolve({
        url: context.url,
        status: 'closed',
        received: 0,
        reason: 'query aborted',
      });
    }
    return new Promise((resolve) => {
      const entry: QueuedRelayQuery = {
        context,
        generation: this.queryGeneration,
        resolve,
        cancelled: false,
        abortCleanup: null,
      };
      if (context.options.abort) {
        const abort = () => {
          entry.cancelled = true;
          resolve({
            url: context.url,
            status: 'closed',
            received: 0,
            reason: 'query aborted',
          });
        };
        context.options.abort.addEventListener('abort', abort, { once: true });
        entry.abortCleanup = () => context.options.abort?.removeEventListener('abort', abort);
      }
      const queue = this.queuedQueriesByRelay.get(context.url) ?? { entries: [], head: 0 };
      queue.entries.push(entry);
      this.queuedQueriesByRelay.set(context.url, queue);
      this.drainRelayQueryQueue(context.url);
    });
  }

  private drainRelayQueryQueue(url: string): void {
    const queue = this.queuedQueriesByRelay.get(url);
    if (!queue) return;

    let active = this.activeQueriesByRelay.get(url) ?? 0;
    while (
      active < this.maxConcurrentQueriesPerRelay &&
      queue.head < queue.entries.length
    ) {
      const entry = queue.entries[queue.head++];
      entry.abortCleanup?.();
      entry.abortCleanup = null;
      if (entry.cancelled) continue;
      if (entry.generation !== this.queryGeneration) {
        entry.resolve({
          url,
          status: 'closed',
          received: 0,
          reason: 'relay pool destroyed',
        });
        continue;
      }
      if (entry.context.options.abort?.aborted) {
        entry.resolve({
          url,
          status: 'closed',
          received: 0,
          reason: 'query aborted',
        });
        continue;
      }

      active += 1;
      this.activeQueriesByRelay.set(url, active);
      void this.queryRelay(entry.context)
        .then(entry.resolve)
        .finally(() => {
          const remaining = Math.max(0, (this.activeQueriesByRelay.get(url) ?? 1) - 1);
          if (remaining === 0) this.activeQueriesByRelay.delete(url);
          else this.activeQueriesByRelay.set(url, remaining);
          this.drainRelayQueryQueue(url);
        });
    }

    if (queue.head === queue.entries.length) this.queuedQueriesByRelay.delete(url);
  }

  private queryRelay(context: QueryRelayContext): Promise<QueryRelayResult> {
    const { url, options, events } = context;
    return new Promise((resolve) => {
      let close = () => {};
      let ended = false;
      close = context.subscribe({
        relays: [url],
        filters: options.filters,
        timeoutMs: options.timeoutMs,
        abort: options.abort,
        signAuth: options.signAuth,
        onclose: options.onclose,
        onerror: options.onerror,
        alreadyHaveEvent: (id) => events.has(id),
        onReceived: options.onReceived,
        onEvent: (event) => {
          if (!events.has(event.id)) {
            events.set(event.id, event);
            options.onEvent?.(event);
          }
        },
        onEnd: (results) => {
          ended = true;
          close();
          resolve(results[0]);
        },
      });
      // A pre-aborted or synchronously completed subscription may notify before
      // returning its closer. In either case it must leave no reconnect demand.
      if (ended) close();
    });
  }

  private publishWithTimeout(
    relay: AbstractRelay,
    event: Event,
    timeoutMs?: number,
  ): Promise<string> {
    if (timeoutMs == null) return relay.publish(event);
    const previous = relay.publishTimeout;
    relay.publishTimeout = timeoutMs;
    const pending = relay.publish(event);
    relay.publishTimeout = previous;
    return pending;
  }

  private authenticate(relay: AbstractRelay, signAuth: SignAuth): Promise<string> {
    return withTimeout(
      relay.auth(signAuth as (event: EventTemplate) => Promise<VerifiedEvent>),
      AUTH_TIMEOUT_MS,
      'auth timed out',
    );
  }
}

/** Observer exceptions must not strand an initial read or block AUTH resubscription. */
function notifyQueryObserver(notify: () => void): void {
  try {
    notify();
  } catch (error) {
    console.error('[relay.subscription] Observer failed.', error);
  }
}

/** Makes nostr-tools' BunkerSigner use the managed connections without keeping
 * a second SimplePool with a different lifecycle. */
class ManagedAbstractPoolAdapter extends AbstractSimplePool {
  constructor(
    private readonly managed: ManagedRelayPool,
    verifyEvent: (event: Event, relayUrl: string) => boolean,
  ) {
    super({
      verifyEvent,
      enablePing: false,
      enableReconnect: false,
      maxWaitForConnection: CONNECTION_TIMEOUT_MS,
    });
  }

  override ensureRelay(
    url: string,
    params?: { connectionTimeout?: number; abort?: AbortSignal },
  ): Promise<AbstractRelay> {
    return abortable(
      this.managed.ensureRelay(url, params?.connectionTimeout ?? CONNECTION_TIMEOUT_MS),
      params?.abort,
    );
  }

  override subscribe(
    relays: string[],
    filter: Filter,
    params: SubscribeManyParams,
  ): SubCloser {
    return this.subscribeMany(relays, filter, params);
  }

  override subscribeMany(
    relays: string[],
    filter: Filter,
    params: SubscribeManyParams,
  ): SubCloser {
    const urls = normalizeRelayUrls(relays);
    const terminalReasons = new Map<string, string>();
    let closed = false;
    let maxWaitHandle: ReturnType<typeof setTimeout> | null = null;
    let abortCleanup: (() => void) | null = null;

    const unsubscribe = this.managed.subscribe({
      label: params.label,
      relays: urls,
      filter,
      onEvent: params.onevent ?? (() => {}),
      onEose: params.oneose,
      onInvalidEvent: params.oninvalidevent,
      onReceivedRelay: params.receivedEvent,
      alreadyHaveEvent: params.alreadyHaveEvent,
      signAuth: params.onauth as SignAuth | undefined,
      onRelayClose: (url, reason) => {
        terminalReasons.set(url, reason);
        if (terminalReasons.size === urls.length) close(reason);
      },
    });

    const close = (reason = 'closed by caller') => {
      if (closed) return;
      closed = true;
      if (maxWaitHandle) clearTimeout(maxWaitHandle);
      abortCleanup?.();
      // Match AbstractSimplePool's asynchronous closer. BunkerSigner closes its
      // handshake subscription immediately before setting its success flag.
      queueMicrotask(() => {
        unsubscribe();
        params.onclose?.(
          urls.map((url) => ({ url, reason: terminalReasons.get(url) ?? reason })),
        );
      });
    };

    if (params.maxWait != null) maxWaitHandle = setTimeout(() => close('subscription timed out'), params.maxWait);
    if (params.abort) {
      const abort = () => close(String(params.abort?.reason ?? 'aborted'));
      if (params.abort.aborted) abort();
      else {
        params.abort.addEventListener('abort', abort, { once: true });
        abortCleanup = () => params.abort?.removeEventListener('abort', abort);
      }
    }

    return { close };
  }

  override async querySync(
    relays: string[],
    filter: Filter,
    params?: Pick<SubscribeManyParams, 'maxWait'>,
  ): Promise<Event[]> {
    const result = await this.managed.query({
      relays,
      filter,
      timeoutMs: params?.maxWait ?? CONNECTION_TIMEOUT_MS,
    });
    if (result.status === 'failed') throw new RelayQueryError(result.relays);
    return result.events;
  }

  override async get(
    relays: string[],
    filter: Filter,
    params?: Pick<SubscribeManyParams, 'maxWait'>,
  ): Promise<Event | null> {
    const events = await this.querySync(relays, { ...cloneFilter(filter), limit: 1 }, params);
    events.sort((a, b) => b.created_at - a.created_at);
    return events[0] ?? null;
  }

  override publish(
    relays: string[],
    event: Event,
    params?: {
      onauth?: (event: EventTemplate) => Promise<VerifiedEvent>;
      maxWait?: number;
      abort?: AbortSignal;
    },
  ): Promise<string>[] {
    return normalizeRelayUrls(relays).map(async (url) => {
      const outcome = await this.managed.publishToRelay({
        url,
        event,
        signAuth: params?.onauth as SignAuth | undefined,
        timeoutMs: params?.maxWait,
        abort: params?.abort,
      });
      if (!outcome.ok) throw new Error(outcome.reason);
      return outcome.message ?? '';
    });
  }

  override close(relays: string[]): void {
    this.managed.closeRelays(relays);
  }

  override listConnectionStatus(): Map<string, boolean> {
    return this.managed.listConnectionStatus();
  }

  override destroy(): void {
    this.managed.destroy();
  }

  override pruneIdleRelays(): string[] {
    return [];
  }
}

class BoundedIdSet {
  private readonly values = new Map<string, true>();

  constructor(private readonly limit: number) {}

  has(id: string): boolean {
    return this.values.has(id);
  }

  add(id: string): void {
    if (this.values.has(id)) return;
    this.values.set(id, true);
    if (this.values.size <= this.limit) return;
    const oldest = this.values.keys().next().value as string | undefined;
    if (oldest) this.values.delete(oldest);
  }
}

function normalizeRelayUrls(relays: string[]): string[] {
  return Array.from(new Set(relays.map(normalizeRelayUrl)));
}

function cloneFilter(filter: Filter): Filter {
  return Object.fromEntries(
    Object.entries(filter).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]),
  ) as Filter;
}

function normalizeSubscriptionFilters(options: ManagedSubscribeOptions): Filter[] {
  const filters = options.filters ?? (options.filter ? [options.filter] : []);
  if (filters.length === 0) {
    throw new Error('A relay subscription requires at least one filter.');
  }
  return filters.map(cloneFilter);
}

function normalizeQueryFilters(options: ManagedQueryOptions): Filter[] {
  const filters = options.filters ?? (options.filter ? [options.filter] : []);
  if (filters.length === 0) {
    throw new Error('A relay query requires at least one filter.');
  }
  return filters.map(cloneFilter);
}

function normalizeQueryConcurrency(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_CONCURRENT_QUERIES_PER_RELAY;
  if (!Number.isFinite(value)) throw new Error('Relay query concurrency must be finite.');
  return Math.max(1, Math.floor(value));
}

function isRetryableSubscriptionClose(reason: string): boolean {
  const prefix = reason.split(':', 1)[0].trim().toLowerCase();
  return !['blocked', 'restricted', 'invalid', 'pow', 'duplicate', 'unsupported'].includes(prefix);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const handle = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(handle);
        resolve(value);
      },
      (error) => {
        clearTimeout(handle);
        reject(error);
      },
    );
  });
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error('aborted'));
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error('aborted'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}
