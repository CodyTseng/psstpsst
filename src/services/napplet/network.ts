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
  type QueryRelayResult,
  type ManagedSubscribeOptions,
} from '@/services/relay/managed-relay-pool';
import type { Signer } from '@/services/signer/signer.interface';
import { MARKET_RELAYS, eventWeight, publicUrl } from './protocol';

export function relayUrls(values: unknown, fallback = MARKET_RELAYS): string[] {
  const urls = values == null ? fallback : values;
  if (!Array.isArray(urls) || urls.length > 8 || urls.some((v) => typeof v !== 'string'))
    throw new Error('invalid-relays');
  return [...new Set(urls.map((v) => publicUrl(v, true)))];
}
const livePools = new Set<ManagedRelayPool>();
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
/** Pools never cross account or AUTH boundaries, including the remote signer's transport. */
export class NappletNetwork {
  readonly pool = new ManagedRelayPool({
    observeLifecycle: false,
    verifyEvent: (e, relay) => Number.isFinite(eventWeight(e)) && verifyEventNativeFirst(e, relay),
  });
  private authPool = new ManagedRelayPool({
    observeLifecycle: false,
    verifyEvent: (e, relay) => Number.isFinite(eventWeight(e)) && verifyEventNativeFirst(e, relay),
  });
  private signerPool = new ManagedRelayPool({
    observeLifecycle: false,
    verifyEvent: (e) => verifyEvent(e),
  });
  private signer: Promise<Signer> | undefined;
  private lifetime = new AbortController();
  private metadata = new Map<string, { expires: number; event: Event | null; bytes: number }>();
  private metadataBytes = 0;
  private destinations = new Set<string>();
  constructor(readonly accountPubkey: string) {
    [this.pool, this.authPool, this.signerPool].forEach((pool) => livePools.add(pool));
    observePools();
  }
  private admit(relays: readonly string[]) {
    const next = new Set([...this.destinations, ...relays]);
    if (next.size > 24) throw new Error('relay-quota-exceeded');
    this.destinations = next;
  }
  async getSigner(): Promise<Signer> {
    assertNotAborted(this.lifetime.signal);
    this.signer ??= buildSigner(this.accountPubkey, this.signerPool.underlyingPool);
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
    this.admit(options.relays);
    return (auth ? this.authPool : this.pool).subscribe({ ...options, signAuth: auth });
  }
  query(
    relays: string[],
    filters: Filter[],
    signal?: AbortSignal,
    auth?: (event: EventTemplate) => Promise<Event>,
    timeoutMs = 10000,
  ) {
    this.admit(relays);
    const linked = linkAbort(signal ? [this.lifetime.signal, signal] : [this.lifetime.signal]);
    const abort = linked.signal;
    return new Promise<{ events: Event[]; incomplete: boolean; error?: string }>(
      (resolve, reject) => {
        const events = new Map<string, Event>();
        let bytes = 0;
        let done = false;
        let close = () => {};
        const finish = (results?: QueryRelayResult[]) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          abort.removeEventListener('abort', cancel);
          linked.dispose();
          close();
          if (abort.aborted) reject(new Error('session-closed'));
          else
            resolve({
              events: [...events.values()],
              incomplete:
                !results ||
                results.some((r) => r.status !== 'eose' || r.reason !== undefined),
              error:
                !events.size && (!results || results.every((r) => r.status !== 'eose' || r.reason !== undefined))
                  ? 'network-error'
                  : undefined,
            });
        };
        const cancel = () => finish();
        const timer = setTimeout(() => finish(), timeoutMs);
        abort.addEventListener('abort', cancel, { once: true });
        if (abort.aborted) {
          finish();
          return;
        }
        close = (auth ? this.authPool : this.pool).subscribe({
          relays,
          filters,
          timeoutMs: Math.max(50, timeoutMs - 50),
          abort,
          signAuth: auth,
          onEvent: (event) => {
            if (done || events.has(event.id) || !matchFilters(filters, event)) return;
            const weight = eventWeight(event);
            if (events.size >= 500 || bytes + weight > 4 * 1024 * 1024) {
              finish();
              return;
            }
            bytes += weight;
            events.set(event.id, event);
          },
          onEnd: (results) => finish(results),
        });
        if (done) close();
      },
    );
  }
  async replaceable(pubkey: string, kind: number, signal?: AbortSignal): Promise<Event | null> {
    assertNotAborted(signal);
    const key = `${pubkey}:${kind}`;
    const cached = this.metadata.get(key);
    if (cached && cached.expires > Date.now()) return cached.event;
    const result = await this.query(
      kind === 10002 ? [...new Set([...MARKET_RELAYS, ...DISCOVERY_RELAYS])] : MARKET_RELAYS,
      [{ authors: [pubkey], kinds: [kind], limit: 1 }],
      signal,
    );
    if (result.error) throw new Error(result.error);
    const event =
      result.events.sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0] ??
      null;
    if (!result.incomplete) {
      const bytes = event ? eventWeight(event) : 128;
      const prior = this.metadata.get(key);
      if (prior) {
        this.metadataBytes -= prior.bytes;
        this.metadata.delete(key);
      }
      while (this.metadata.size >= 256 || this.metadataBytes + bytes > 4 * 1024 * 1024) {
        const oldest = this.metadata.keys().next().value;
        if (!oldest) break;
        this.metadataBytes -= this.metadata.get(oldest)!.bytes;
        this.metadata.delete(oldest);
      }
      this.metadata.set(key, { event, bytes, expires: Date.now() + 60000 });
      this.metadataBytes += bytes;
    }
    return event;
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
    this.admit(relays);
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
                timeoutMs: 8000,
                abort: this.lifetime.signal,
              })
            ).ok,
          ] as const,
      ),
    );
    assertNotAborted(this.lifetime.signal);
    return Object.fromEntries(results);
  }
  destroy(): void {
    [this.pool, this.authPool, this.signerPool].forEach((pool) => livePools.delete(pool));
    this.lifetime.abort();
    this.pool.destroy();
    this.authPool.destroy();
    this.signerPool.destroy();
    this.metadata.clear();
    void this.signer?.then((s) => s.destroy?.()).catch(() => {});
  }
}
