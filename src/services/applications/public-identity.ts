import { nip19, type Event } from 'nostr-tools';
import { assertNotAborted } from '@/platform/abort';
import { localRelay } from '@/services/local-relay';
import { eventWeight } from '@/services/napplet/protocol';
import { metadataFilters } from '@/services/napplet/metadata-batch';
import type { ApplicationNetwork } from './network';
import { relayUrls } from './relay-urls';

import { normalizePublicKey, newerPublicEvent, profileMetadata } from './public-identity-model';
export { isPublicKey, normalizePublicKey, newerPublicEvent, profileMetadata, followedPubkeys } from './public-identity-model';

type ReadOptions = { fresh?: boolean; requireComplete?: boolean; relays?: string[] };
type Request = { pubkey: string; kind: number; relays: string[]; requireComplete: boolean; resolve(event: Event | null): void; reject(error: unknown): void };
type Cached = { event: Event | null; expires: number; bytes: number };
const readers = new Set<PublicIdentityData>();

/** A successful host publication refreshes only the owning account's public views. */
export function rememberPublishedIdentity(network: ApplicationNetwork, event: Event) {
  for (const reader of readers) if (reader.network.accountPubkey === network.accountPubkey) reader.published(event);
}

/** Shared public identity reads use author write routes, bounded caches and coalesced queries. */
export class PublicIdentityData {
  private cache = new Map<string, Cached>();
  private bytes = 0;
  private inflight = new Map<string, Promise<Event | null>>();
  private queue: Request[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  constructor(readonly network: ApplicationNetwork, readonly signal: AbortSignal) {
    this.check();
    readers.add(this);
    const detach = localRelay.subscribe({}, event => {
      const key = `${event.pubkey}:${event.kind}`, old = this.cache.get(key);
      if (old) { this.bytes -= old.bytes; this.cache.delete(key); }
    });
    signal.addEventListener('abort', () => {
      readers.delete(this);
      detach(); clearTimeout(this.timer);
      for (const request of this.queue.splice(0)) request.reject(new Error('session-closed'));
      this.cache.clear(); this.inflight.clear(); this.bytes = 0;
    }, { once: true });
  }
  private check() { assertNotAborted(this.signal); }
  metadata(value: string, kind: number, options: ReadOptions = {}): Promise<Event | null> {
    try {
      this.check();
      const pubkey = normalizePublicKey(value), key = `${pubkey}:${kind}`;
      const cached = this.cache.get(key);
      if (!options.fresh && cached && cached.expires > Date.now()) return Promise.resolve(cached.event);
      // Relay discovery cannot recurse through author write-route resolution.
      if (kind === 10002) return this.network.replaceable(pubkey, kind, this.signal);
      const relays = options.relays?.length ? relayUrls(options.relays, []).sort() : [];
      const pendingKey = `${key}:${!!options.requireComplete}:${!!options.fresh}:${JSON.stringify(relays)}`;
      const prior = this.inflight.get(pendingKey);
      if (prior) return prior;
      const job = new Promise<Event | null>((resolve, reject) => {
        this.queue.push({ pubkey, kind, relays, requireComplete: !!options.requireComplete, resolve, reject });
        this.timer ??= setTimeout(() => { this.timer = undefined; void this.flush(); }, 8);
      }).finally(() => this.inflight.delete(pendingKey));
      this.inflight.set(pendingKey, job);
      return job;
    } catch (error) { return Promise.reject(error); }
  }
  async profile(value: string, relays: string[] = []) {
    const pubkey = normalizePublicKey(value);
    if (/^(?:nostr:)?nprofile1/i.test(value)) {
      const decoded = nip19.decode(value.replace(/^nostr:/i, ''));
      if (decoded.type === 'nprofile') relays = [...relays, ...(decoded.data.relays ?? [])];
    }
    const event = await this.metadata(pubkey, 0, { relays });
    return { event, metadata: profileMetadata(event) };
  }
  follows(pubkey: string, options: ReadOptions = {}) { return this.metadata(pubkey, 3, options); }
  published(event: Event) {
    if (!(event.kind === 0 || event.kind === 3 || event.kind >= 10000 && event.kind < 20000)) return;
    const key = `${event.pubkey}:${event.kind}`;
    this.remember(key, newerPublicEvent(this.cache.get(key)?.event, event));
  }
  private remember(key: string, event: Event | null) {
    const bytes = event ? eventWeight(event) : 128;
    if (!Number.isFinite(bytes) || bytes > 4 * 1024 * 1024) return;
    const old = this.cache.get(key);
    if (old) { this.bytes -= old.bytes; this.cache.delete(key); }
    while (this.cache.size >= 256 || this.bytes + bytes > 4 * 1024 * 1024) {
      const first = this.cache.keys().next().value;
      if (!first) break;
      this.bytes -= this.cache.get(first)!.bytes; this.cache.delete(first);
    }
    this.cache.set(key, { event, bytes, expires: Date.now() + 60000 }); this.bytes += bytes;
  }
  private async flush() {
    const requests = this.queue.splice(0);
    type Read = { requests: Request[]; event: Event | null; complete: number; expected: number; error?: unknown };
    const reads = new Map<string, Read>(), byAuthor = new Map<string, Read[]>();
    for (const request of requests) {
      const key = `${request.pubkey}:${request.kind}`, prior = reads.get(key);
      if (prior) { prior.requests.push(request); continue; }
      const read: Read = { requests: [request], event: null, complete: 0, expected: 0 };
      reads.set(key, read);
      const author = byAuthor.get(request.pubkey) ?? []; author.push(read); byAuthor.set(request.pubkey, author);
    }
    const merge = (event: Event) => {
      const read = reads.get(`${event.pubkey}:${event.kind}`);
      if (read) read.event = newerPublicEvent(read.event, event);
    };
    try {
      for (const filters of metadataFilters(requests)) { for (const event of await localRelay.query(filters)) merge(event); this.check(); }
      const authors = [...byAuthor.keys()], routes = new Map<string, Map<string, Read>>();
      let offset = 0;
      await Promise.all(Array.from({ length: Math.min(authors.length, 4) }, async () => {
        while (offset < authors.length) {
          const pubkey = authors[offset++];
          const targets = [...new Set(await this.network.routes([pubkey], 'write', false, this.signal))]; this.check();
          for (const read of byAuthor.get(pubkey)!) {
            const destinations = new Set([...targets, ...read.requests.flatMap(request => request.relays)]);
            read.expected = destinations.size;
            for (const relay of destinations) {
              const routed = routes.get(relay) ?? new Map<string, Read>();
              routed.set(`${pubkey}:${read.requests[0].kind}`, read);
              routes.set(relay, routed);
            }
          }
        }
      }));
      const jobs: { relay: string; filters: ReturnType<typeof metadataFilters>[number]; affected: Read[] }[] = [];
      for (const [relay, routed] of routes) for (const filters of metadataFilters([...routed.values()].map(read => read.requests[0]))) {
        const keys = new Set(filters.flatMap(filter => filter.authors!.flatMap(author => filter.kinds!.map(kind => `${author}:${kind}`))));
        jobs.push({ relay, filters, affected: [...routed.entries()].filter(([key]) => keys.has(key)).map(([, read]) => read) });
      }
      offset = 0;
      await Promise.all(Array.from({ length: Math.min(jobs.length, 4) }, async () => {
        while (offset < jobs.length) {
          const job = jobs[offset++];
          try {
            const result = await this.network.query([job.relay], job.filters, this.signal, undefined, 10000);
            this.check();
            for (const event of result.events) merge(event);
            for (const read of job.affected) {
              if (!result.incomplete && !result.error) read.complete++;
              else read.error = new Error(result.error ?? 'network-error');
            }
          } catch (error) { for (const read of job.affected) read.error = error; }
        }
      }));
      this.check();
      for (const [key, read] of reads) {
        read.event = newerPublicEvent(read.event, this.cache.get(key)?.event);
        const complete = read.expected > 0 && read.complete === read.expected;
        if (complete) this.remember(key, read.event);
        for (const request of read.requests) {
          if (!complete && (request.requireComplete || !read.event && !read.complete)) request.reject(read.error ?? new Error('network-error'));
          else request.resolve(read.event);
        }
      }
    } catch (error) { for (const request of requests) request.reject(error); }
  }
}
