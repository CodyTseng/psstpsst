import { assertNotAborted, linkAbort } from '@/platform/abort';
import { platform } from '@/platform';
import { DISCOVERY_RELAYS } from '@/lib/nostr/relay-url';
import {
  matchFilters,
  verifyEvent,
  type Event,
  type EventTemplate,
  type Filter,
} from 'nostr-tools';
import { verifyEventNativeFirst } from '@/services/relay/relay-pool';
import { buildSigner } from '@/services/account/account-access';
import {
  ManagedRelayPool,
  type ManagedSubscribeOptions,
} from '@/services/relay/managed-relay-pool';
import type { Signer } from '@/services/signer/signer.interface';
import { MARKET_RELAYS, eventWeight, publicUrl } from './protocol';
import { RelayBudget } from './relay-budget';
import { metadataFilters } from './metadata-batch';

export function relayUrls(values: unknown, fallback = MARKET_RELAYS): string[] {
  const urls = values == null ? fallback : values;
  if (!Array.isArray(urls) || urls.length > 8 || urls.some((v) => typeof v !== 'string'))
    throw new Error('invalid-relays');
  return [...new Set(urls.map((v) => publicUrl(v, true)))];
}
const livePools = new Set<ManagedRelayPool>();
type MetadataWaiter = { resolve(event: Event | null): void; reject(error: unknown): void; cleanup(): void };
type PendingMetadata = { key: string; pubkey: string; kind: number; waiters: Set<MetadataWaiter>; batch?: MetadataBatch };
type MetadataBatch = { requests: PendingMetadata[]; controller: AbortController };
type NetworkRead = { events: Event[]; eventRelays?: Map<string, string[]>; incomplete: boolean; error?: string };
let observing = false;
function observePools() {
  if (observing) return;
  observing = true;
  platform.appState.addChangeListener((state) => {
    for (const pool of livePools) pool.updateAppState(state);
  });
  platform.networkState.addStateListener((state) => {
    for (const pool of livePools) pool.updateNetworkState(state);
  });
  void platform.networkState
    .getState()
    .then((state) => {
      for (const pool of livePools) pool.updateNetworkState(state, true);
    })
    .catch(() => {});
}
/** Application relay pools never cross account or AUTH boundaries. */
export class NappletNetwork {
  readonly pool = new ManagedRelayPool({
    observeLifecycle: false,
    verifyEvent: (e, relay) => Number.isFinite(eventWeight(e)) && verifyEventNativeFirst(e, relay),
  });
  private authPool = new ManagedRelayPool({
    observeLifecycle: false,
    verifyEvent: (e, relay) => Number.isFinite(eventWeight(e)) && verifyEventNativeFirst(e, relay),
  });
  private signer: Promise<Signer> | undefined;
  private lifetime = new AbortController();
  private metadata = new Map<string, { expires: number; event: Event | null; bytes: number }>();
  private metadataBytes = 0;
  private pendingMetadata = new Map<string, PendingMetadata>();
  private metadataQueue = new Set<PendingMetadata>();
  private metadataTimer?: ReturnType<typeof setTimeout>;
  private destinations = new RelayBudget(relays => {
    this.pool.forgetIdleRelays(relays); this.authPool.forgetIdleRelays(relays);
  });
  constructor(readonly accountPubkey: string) {
    [this.pool, this.authPool].forEach((pool) => livePools.add(pool));
    observePools();
  }
  async getSigner(): Promise<Signer> {
    assertNotAborted(this.lifetime.signal);
    this.signer ??= buildSigner(this.accountPubkey);
    const signer = await this.signer;
    if (this.lifetime.signal.aborted) {
      await signer.destroy?.();
      throw new Error('session-closed');
    }
    return signer;
  }
  async sign(template: EventTemplate): Promise<Event> {
    const signer = await this.getSigner();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assertNotAborted(this.lifetime.signal);
    const event = await signer.signEvent(template);
    assertNotAborted(this.lifetime.signal);
    if (
      event.pubkey !== this.accountPubkey ||
      event.kind !== template.kind ||
      event.created_at !== template.created_at ||
      event.content !== template.content ||
      JSON.stringify(event.tags) !== JSON.stringify(template.tags) ||
      !verifyEvent(event)
    )
      throw new Error('invalid-signature');
    return event;
  }
  subscribe(
    options: ManagedSubscribeOptions,
    auth?: (event: EventTemplate) => Promise<Event>,
  ): () => void {
    assertNotAborted(this.lifetime.signal); assertNotAborted(options.abort);
    const release = this.destinations.tryAcquire(options.relays);
    if (!release) throw new Error('relay-quota-exceeded');
    const linked = linkAbort(options.abort ? [this.lifetime.signal, options.abort] : [this.lifetime.signal]);
    let closed = false, close = () => {};
    const finish = () => {
      if (closed) return;
      closed = true; linked.signal.removeEventListener('abort', finish);
      try { close(); } finally { linked.dispose(); release(); }
    };
    linked.signal.addEventListener('abort', finish, { once: true });
    try {
      if (linked.signal.aborted) { finish(); return finish; }
      close = (auth ? this.authPool : this.pool).subscribe({ ...options, abort: linked.signal, signAuth: auth });
      if (closed) close();
      return finish;
    } catch (error) { finish(); throw error; }
  }
  query(
    relays: string[],
    filters: Filter[],
    signal?: AbortSignal,
    auth?: (event: EventTemplate) => Promise<Event>,
    timeoutMs = 10000,
  ): Promise<NetworkRead> {
    assertNotAborted(this.lifetime.signal); assertNotAborted(signal);
    const linked = linkAbort(signal ? [this.lifetime.signal, signal] : [this.lifetime.signal]);
    const deadline = Date.now() + timeoutMs;
    const execute = (release: () => void) => {
      if (linked.signal.aborted) { release(); linked.dispose(); return Promise.reject(new Error('session-closed')); }
      const remaining = deadline - Date.now();
      if (remaining <= 0) { release(); linked.dispose(); return Promise.resolve({ events: [] as Event[], incomplete: true, error: 'network-error' }); }
      return this.readQuery(relays, filters, linked.signal, auth, remaining).finally(() => { linked.dispose(); release(); });
    };
    let release: (() => void) | undefined;
    try { release = this.destinations.tryAcquire(relays); } catch (error) { linked.dispose(); throw error; }
    if (release) return execute(release);
    return this.destinations.acquire(relays, linked.signal, timeoutMs).then(execute, error => {
      linked.dispose();
      if (error instanceof Error && error.message === 'relay-queue-timeout') return { events: [] as Event[], incomplete: true, error: 'network-error' };
      throw error;
    });
  }
  private async readQuery(relays: string[], filters: Filter[], abort: AbortSignal,
    auth: ((event: EventTemplate) => Promise<Event>) | undefined, timeoutMs: number): Promise<NetworkRead> {
    const budget = new AbortController(), linked = linkAbort([abort, budget.signal]);
    const timer = setTimeout(() => budget.abort(), timeoutMs);
    const events = new Map<string, Event>();
    const eventRelays = new Map<string, string[]>();
    let bytes = 0;
    try {
      const result = await (auth ? this.authPool : this.pool).query({
        relays, filters, abort: linked.signal, signAuth: auth, timeoutMs: Math.max(1, timeoutMs - 50),
        onEventSource: (event, relayUrl) => { if (events.has(event.id)) eventRelays.set(event.id, [relayUrl]); },
        onEvent: event => {
          if (events.has(event.id) || !matchFilters(filters, event)) return;
          const weight = eventWeight(event);
          if (events.size >= 500 || bytes + weight > 4 * 1024 * 1024) { budget.abort(); return; }
          bytes += weight; events.set(event.id, event);
        },
      });
      assertNotAborted(abort);
      return { events: [...events.values()], eventRelays,
        incomplete: budget.signal.aborted || !result.relays.length || result.relays.some(relay => relay.status !== 'eose' || relay.reason !== undefined),
        error: !events.size && !result.relays.some(relay => relay.status === 'eose' && relay.reason === undefined) ? 'network-error' : undefined };
    } finally { clearTimeout(timer); linked.dispose(); }
  }
  async replaceable(pubkey: string, kind: number, signal?: AbortSignal): Promise<Event | null> {
    assertNotAborted(signal); assertNotAborted(this.lifetime.signal);
    const key = `${pubkey}:${kind}`, cached = this.metadata.get(key);
    if (cached && cached.expires > Date.now()) return cached.event;
    let request = this.pendingMetadata.get(key);
    if (!request || request.batch?.controller.signal.aborted) {
      if (this.pendingMetadata.size >= 128 && !this.pendingMetadata.has(key)) throw new Error('quota-exceeded');
      request = { key, pubkey, kind, waiters: new Set() };
      this.pendingMetadata.set(key, request); this.metadataQueue.add(request);
      this.metadataTimer ??= setTimeout(() => { this.metadataTimer = undefined; void this.flushMetadata(); }, 8);
    }
    const pending = request;
    if (pending.waiters.size >= 64) throw new Error('quota-exceeded');
    return new Promise((resolve, reject) => {
      const linked = linkAbort(signal ? [this.lifetime.signal, signal] : [this.lifetime.signal]);
      const cancel = () => {
        pending.waiters.delete(waiter); waiter.cleanup(); reject(new Error('session-closed'));
        const batch = pending.batch;
        if (batch && batch.requests.every(request => !request.waiters.size)) batch.controller.abort();
        if (!batch && !pending.waiters.size) { this.metadataQueue.delete(pending); if (this.pendingMetadata.get(key) === pending) this.pendingMetadata.delete(key); }
      };
      const waiter: MetadataWaiter = { resolve, reject, cleanup: () => { linked.signal.removeEventListener('abort', cancel); linked.dispose(); } };
      pending.waiters.add(waiter); linked.signal.addEventListener('abort', cancel, { once: true });
      if (linked.signal.aborted) cancel();
    });
  }
  private async flushMetadata() {
    const queued = [...this.metadataQueue]; this.metadataQueue.clear();
    const groups = new Map<boolean, PendingMetadata[]>();
    for (const request of queued) if (request.waiters.size) {
      const discovery = request.kind === 10002 || request.kind === 10063;
      const group = groups.get(discovery) ?? []; group.push(request); groups.set(discovery, group);
    }
    const jobs: { discovery: boolean; requests: PendingMetadata[] }[] = [];
    for (const [discovery, requests] of groups) for (let offset = 0; offset < requests.length; offset += 32)
      jobs.push({ discovery, requests: requests.slice(offset, offset + 32) });
    await Promise.all(Array.from({ length: Math.min(jobs.length, 4) }, async () => {
      for (let job = jobs.shift(); job; job = jobs.shift()) await this.fetchMetadataBatch(job.requests, job.discovery);
    }));
  }
  private async fetchMetadataBatch(requests: PendingMetadata[], discovery: boolean) {
    requests = requests.filter(request => request.waiters.size);
    if (!requests.length) return;
    const batch: MetadataBatch = { requests, controller: new AbortController() };
    for (const request of requests) request.batch = batch;
    const events = new Map<string, Event>(), completed = new Set<string>(), failures = new Map<string, unknown>();
    const relays = discovery ? [...new Set([...MARKET_RELAYS, ...DISCOVERY_RELAYS])] : MARKET_RELAYS;
    try {
      for (const filters of metadataFilters(requests)) {
        const affected = requests.filter(request => filters.some(filter => filter.kinds!.includes(request.kind) && filter.authors!.includes(request.pubkey)));
        try {
          const result = await this.query(relays, filters, batch.controller.signal);
          for (const event of result.events) {
            const key = `${event.pubkey}:${event.kind}`, previous = events.get(key);
            if (!previous || event.created_at > previous.created_at || event.created_at === previous.created_at && event.id < previous.id) events.set(key, event);
          }
          for (const request of affected) {
            if (!result.incomplete && !result.error) completed.add(request.key);
            else failures.set(request.key, new Error(result.error ?? 'network-error'));
          }
        } catch (error) { for (const request of affected) failures.set(request.key, error); }
      }
    } finally {
      for (const request of requests) {
        if (this.pendingMetadata.get(request.key) === request) this.pendingMetadata.delete(request.key);
        const event = events.get(request.key) ?? null, error = failures.get(request.key);
        if (request.waiters.size && completed.has(request.key) && !this.lifetime.signal.aborted) this.cacheMetadata(request.key, event);
        for (const waiter of request.waiters) {
          waiter.cleanup();
          if (error && !event) waiter.reject(error); else waiter.resolve(event);
        }
        request.waiters.clear();
      }
    }
  }
  private cacheMetadata(key: string, event: Event | null) {
    const bytes = event ? eventWeight(event) : 128, prior = this.metadata.get(key);
    if (prior) { this.metadataBytes -= prior.bytes; this.metadata.delete(key); }
    while (this.metadata.size >= 256 || this.metadataBytes + bytes > 4 * 1024 * 1024) {
      const oldest = this.metadata.keys().next().value;
      if (!oldest) break;
      this.metadataBytes -= this.metadata.get(oldest)!.bytes; this.metadata.delete(oldest);
    }
    this.metadata.set(key, { event, bytes, expires: Date.now() + 60000 }); this.metadataBytes += bytes;
  }
  async mediaServers(pubkey: string, signal?: AbortSignal): Promise<string[]> {
    const event = await this.replaceable(pubkey, 10063, signal);
    const servers = new Set<string>();
    for (const tag of event?.tags ?? []) {
      if (tag[0] !== 'server') continue;
      try { servers.add(publicUrl(tag[1])); } catch { /* Ignore unusable public server hints. */ }
      if (servers.size === 8) break;
    }
    return [...servers];
  }
  async publisherRelays(pubkey: string): Promise<string[]> {
    if (!/^[a-f0-9]{64}$/.test(pubkey)) throw new Error('invalid-author');
    const event = await this.replaceable(pubkey, 10002);
    return [...new Set(event?.tags
      .filter((tag) => tag[0] === 'r' && (!tag[2] || tag[2] === 'write'))
      .flatMap((tag) => {
        try { return [publicUrl(tag[1], true)]; }
        catch { return []; }
      }) ?? [])].slice(0, 4);
  }
  async routes(
    pubkeys: string[],
    direction: 'read' | 'write',
    required = false,
    signal?: AbortSignal,
  ): Promise<string[]> {
    if (pubkeys.length > 16 || pubkeys.some((p) => !/^[a-f0-9]{64}$/.test(p)))
      throw new Error('invalid-authors');
    const urls = new Set<string>();
    for (let offset = 0; offset < pubkeys.length; offset += 4) {
      await Promise.all(
        pubkeys.slice(offset, offset + 4).map(async (pubkey) => {
          const event = await this.replaceable(pubkey, 10002, signal).catch(() => {
            assertNotAborted(signal);
            assertNotAborted(this.lifetime.signal);
            return null;
          });
          const candidates =
            event?.tags
              .filter((t) => t[0] === 'r' && (!t[2] || t[2] === direction))
              .flatMap((t) => {
                try {
                  return [publicUrl(t[1], true)];
                } catch {
                  return [];
                }
              })
              .slice(0, 4) ?? [];
          if (required && !candidates.length) throw new Error('recipient-relays-unavailable');
          for (const url of candidates.length ? candidates : MARKET_RELAYS) urls.add(url);
        }),
      );
    }
    if (urls.size > 16) throw new Error('too-many-relays');
    return urls.size ? [...urls] : required ? [] : MARKET_RELAYS;
  }
  async publish(
    event: Event,
    relays: string[],
    auth?: (template: EventTemplate) => Promise<Event>,
  ) {
    assertNotAborted(this.lifetime.signal);
    const deadline = Date.now() + 8000;
    const release = await this.destinations.acquire(relays, this.lifetime.signal, 8000);
    try {
      assertNotAborted(this.lifetime.signal);
      const results = await Promise.all(
        relays.map(
          async (url) =>
            [
              url,
              (
                await (auth ? this.authPool : this.pool).publishToRelay({
                  url,
                  event,
                  signAuth: auth,
                  timeoutMs: Math.max(1, deadline - Date.now()),
                  abort: this.lifetime.signal,
                })
              ).ok,
            ] as const,
        ),
      );
      assertNotAborted(this.lifetime.signal);
      return Object.fromEntries(results);
    } finally { release(); }
  }
  destroy(): void {
    [this.pool, this.authPool].forEach((pool) => livePools.delete(pool));
    this.lifetime.abort();
    this.destinations.close();
    clearTimeout(this.metadataTimer); this.metadataQueue.clear(); this.pendingMetadata.clear();
    this.pool.destroy();
    this.authPool.destroy();
    this.metadata.clear();
    void this.signer?.then((s) => s.destroy?.()).catch(() => {});
  }
}
