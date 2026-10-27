import { nip19, type Event, type Filter } from 'nostr-tools';
import { platform } from '@/platform';
import { assertNotAborted } from '@/platform/abort';
import { localRelay } from '@/services/local-relay';
import { NappletNetwork, relayUrls } from '@/services/napplet/network';
import { publicUrl } from '@/services/napplet/protocol';
import { publicEventAddress } from './event-address';
import { metadataFilters } from '@/services/napplet/metadata-batch';
import { isPublicKey, normalizePublicKey, LIST_KINDS, SET_KINDS, listItems, resolvedSet, type SetPointer } from './lists';

const newer = (a: Event, b: Event) => a.created_at > b.created_at || a.created_at === b.created_at && a.id < b.id;
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 0));
type Cached = { value: any; expires: number; bytes: number };
type MetadataRequest = { pubkey: string; kind: number; resolve(event: Event | null): void; reject(error: unknown): void };

/** Bounded public projections; neither private account caches nor chat tables enter this API. */
export class NappData {
  private cache = new Map<string, Cached>();
  private cacheBytes = 0;
  private inflight = new Map<string, Promise<any>>();
  private metadataQueue: MetadataRequest[] = [];
  private metadataTimer?: ReturnType<typeof setTimeout>;
  private profiles = new Map<string, { user: any; text: string; time: number; id: string; bytes: number }>();
  private profileBytes = 0;
  private seeded?: Promise<void>;
  constructor(readonly account: string, readonly network: NappletNetwork, readonly signal: AbortSignal) {
    const detach = localRelay.subscribe({}, event => {
      for (const key of [`metadata:${event.pubkey}:${event.kind}`, `sets:${event.pubkey}:${event.kind}`]) {
        const cached = this.cache.get(key); if (cached) { this.cacheBytes -= cached.bytes; this.cache.delete(key); }
      }
      if (event.kind === 0) this.index(event);
    });
    signal.addEventListener('abort', () => {
      detach(); clearTimeout(this.metadataTimer);
      for (const request of this.metadataQueue.splice(0)) request.reject(new Error('session-closed'));
      this.cache.clear(); this.profiles.clear();
    }, { once: true });
  }
  check() { assertNotAborted(this.signal); }
  async memo<T>(key: string, work: () => Promise<T>, ttl = 60000): Promise<T> {
    this.check();
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    const prior = this.inflight.get(key);
    if (prior) return prior;
    const job = work().then(value => {
      this.check();
      const bytes = JSON.stringify(value ?? null).length * 2;
      const old = this.cache.get(key);
      if (old) { this.cacheBytes -= old.bytes; this.cache.delete(key); }
      if (bytes <= 4 * 1024 * 1024) {
        while (this.cache.size >= 256 || this.cacheBytes + bytes > 4 * 1024 * 1024) {
          const first = this.cache.keys().next().value;
          if (!first) break;
          this.cacheBytes -= this.cache.get(first)!.bytes; this.cache.delete(first);
        }
        this.cache.set(key, { value, bytes, expires: Date.now() + ttl }); this.cacheBytes += bytes;
      }
      return value;
    }).finally(() => this.inflight.delete(key));
    this.inflight.set(key, job); return job;
  }
  async query(relays: string[], filters: Filter[], timeout = 10000, onEvent?: (event: Event) => void) {
    this.check();
    const response = await (onEvent
      ? this.network.query(relays, filters, this.signal, undefined, timeout, onEvent)
      : this.network.query(relays, filters, this.signal, undefined, timeout));
    this.check();
    if (response.error) throw new Error(response.error);
    return response;
  }
  metadata(pubkey: string, kind: number): Promise<Event | null> {
    try { pubkey = normalizePublicKey(pubkey); } catch (error) { return Promise.reject(error); }
    return this.memo(`metadata:${pubkey}:${kind}`, () => {
      if (kind === 10002) return this.network.replaceable(pubkey, kind, this.signal);
      return new Promise((resolve, reject) => {
        this.metadataQueue.push({ pubkey, kind, resolve, reject });
        this.metadataTimer ??= setTimeout(() => { this.metadataTimer = undefined; void this.flushMetadata(); }, 8);
      });
    });
  }
  private async flushMetadata() {
    const requests = this.metadataQueue.splice(0);
    type Read = { request: MetadataRequest; event: Event | null; complete: number; error?: unknown };
    const reads = new Map<string, Read>(), byAuthor = new Map<string, Read[]>();
    for (const request of requests) {
      const read: Read = { request, event: null, complete: 0 };
      reads.set(`${request.pubkey}:${request.kind}`, read);
      const author = byAuthor.get(request.pubkey) ?? []; author.push(read); byAuthor.set(request.pubkey, author);
    }
    const merge = (event: Event) => {
      const read = reads.get(`${event.pubkey}:${event.kind}`);
      if (read && (!read.event || newer(event, read.event))) read.event = event;
    };
    try {
      for (const filters of metadataFilters(requests)) { for (const event of await localRelay.query(filters)) merge(event); this.check(); }
      const authors = [...byAuthor.keys()];
      const routes = new Map<string, Map<string, Read>>();
      // NIP-65 lookups themselves are coalesced by NappletNetwork before these routed reads start.
      await Promise.all(authors.map(async pubkey => {
        const targets = await this.network.routes([pubkey], 'write', false, this.signal); this.check();
        for (const relay of targets) {
          const routed = routes.get(relay) ?? new Map<string, Read>();
          for (const read of byAuthor.get(pubkey)!) routed.set(`${pubkey}:${read.request.kind}`, read);
          routes.set(relay, routed);
        }
      }));
      const jobs: { relay: string; filters: Filter[]; affected: Read[] }[] = [];
      for (const [relay, routed] of routes) for (const filters of metadataFilters([...routed.values()].map(read => read.request))) {
        const keys = new Set(filters.flatMap(filter => filter.authors!.flatMap(author => filter.kinds!.map(kind => `${author}:${kind}`))));
        jobs.push({ relay, filters, affected: [...routed.entries()].filter(([key]) => keys.has(key)).map(([, read]) => read) });
      }
      await Promise.all(Array.from({ length: Math.min(jobs.length, 4) }, async () => {
        for (let job = jobs.shift(); job; job = jobs.shift()) {
          try {
            const result = await this.query([job.relay], job.filters);
            for (const event of result.events) merge(event);
            for (const read of job.affected) {
              if (!result.incomplete) read.complete++;
              else read.error = new Error('network-error');
            }
          } catch (error) { for (const read of job.affected) read.error = error; }
        }
      }));
      this.check();
      for (const read of reads.values()) {
        if (!read.event && !read.complete && read.error) read.request.reject(read.error);
        else read.request.resolve(read.event);
      }
    } catch (error) { for (const request of requests) request.reject(error); }
  }
  async list(method: string, pubkey: string) {
    const kind = LIST_KINDS[method];
    if (kind === undefined) throw new Error('unsupported-method');
    const event = await this.metadata(pubkey, kind);
    return { event, items: listItems(kind, event) };
  }
  async sets(method: string, pubkey: string) {
    pubkey = normalizePublicKey(pubkey);
    const kind = SET_KINDS[method];
    if (!isPublicKey(pubkey) || kind === undefined) throw new Error('invalid-set-request');
    return this.memo(`sets:${pubkey}:${kind}`, async () => {
      const relays = await this.network.routes([pubkey], 'write', false, this.signal);
      const events = (await this.query(relays, [{ authors: [pubkey], kinds: [kind] }])).events;
      const result = new Map<string, ReturnType<typeof resolvedSet>>();
      for (const event of events) {
        const identifier = event.tags.find(tag => tag[0] === 'd')?.[1] ?? '';
        const previous = result.get(identifier)?.event;
        if (!previous || newer(event, previous)) result.set(identifier, resolvedSet({ kind, pubkey, identifier, relays: [] }, event));
      }
      return Object.fromEntries(result);
    });
  }
  async withSets(method: string, pubkey: string) {
    const list = ({fetchFavoriteRelaysWithSets: 'loadFavoriteRelays', fetchEmojisWithSets: 'loadEmojis', fetchFavoriteFollowSetsWithSets: 'loadFavoriteFollowSets'} as Record<string, string>)[method];
    if (!list) throw new Error('unsupported-method');
    const { items } = await this.list(list, pubkey);
    const pointers = items.filter(item => item && typeof item === 'object' && 'identifier' in item) as SetPointer[];
    const resolved = new Map<SetPointer, unknown>();
    let offset = 0;
    await Promise.all(Array.from({ length: Math.min(pointers.length, 4) }, async () => {
      while (offset < pointers.length) {
        const pointer = pointers[offset++];
        const event = await this.loadEvent(pointer);
        resolved.set(pointer, resolvedSet(pointer, event));
      }
    }));
    return items.map(item => resolved.get(item) ?? item);
  }
  async loadEvent(code: unknown, hints?: unknown, author?: unknown): Promise<Event | null> {
    const pointer = publicEventAddress(code);
    if (author !== undefined && !isPublicKey(author)) throw new Error('invalid-author');
    const explicit = hints === undefined ? pointer.relays : relayUrls(hints, []);
    const filters = pointer.filters;
    const cached = await localRelay.query(filters); this.check();
    if (cached[0]) return cached[0];
    return this.memo(`event:${JSON.stringify([filters, explicit, author])}`, async () => {
      const pubkey = typeof author === 'string' ? author : pointer.author;
      const relays = explicit.length ? explicit : await this.network.routes([pubkey ?? this.account], pubkey ? 'write' : 'read', false, this.signal);
      return (await this.query(relays, filters)).events.reduce<Event | null>((best, event) => !best || newer(event, best) ? event : best, null);
    });
  }
  async loadEvents(input: unknown): Promise<Event[]> {
    if (!Array.isArray(input)) throw new Error('invalid-event-ids');
    const ids = [...new Set(input.filter(isPublicKey))];
    if (!ids.length) return [];
    const result = new Map<string, Event>();
    const collect = (event: Event) => {
      if (result.has(event.id)) return;
      result.set(event.id, event);
    };
    for (let offset = 0; offset < ids.length; offset += 100) {
      const batch = ids.slice(offset, offset + 100);
      for (const event of await localRelay.query({ ids: batch, limit: 100 })) collect(event);
      const missing = batch.filter(id => !result.has(id));
      if (missing.length) {
        const relays = await this.network.routes([this.account], 'read', false, this.signal);
        for (const event of (await this.query(relays, [{ ids: missing, limit: missing.length }])).events) collect(event);
      }
      this.check(); await pause();
    }
    return ids.flatMap(id => result.has(id) ? [result.get(id)!] : []);
  }
  async json(url: string, accept: 'application/json' | 'application/nostr+json' = 'application/json') {
    return this.memo(`json:${accept}:${url}`, async () => {
      const bytes = await platform.napplet.fetchResource(publicUrl(url), 256 * 1024, this.signal, { accept });
      this.check(); await pause();
      return JSON.parse(new TextDecoder().decode(bytes));
    }, 300000);
  }
  async relayInfo(value: string) {
    const url = publicUrl(value.includes('://') ? value : `wss://${value}`, true);
    try {
      const http = new URL(url); http.protocol = 'https:';
      const data = await this.json(http.href, 'application/nostr+json');
      if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
      return { ...data, url, urlSimple: url.replace(/^wss?:\/\//, '').replace(/\/$/, ''), icon: data.icon ?? new URL('/favicon.ico', http).href };
    } catch (error) { this.check(); if (error instanceof Error && error.message === 'napplets.rebuild_required') throw error; return null; }
  }
  private index(event: Event) {
    const old = this.profiles.get(event.pubkey);
    if (old && (old.time > event.created_at || old.time === event.created_at && old.id <= event.id)) return old.user;
    let metadata: Record<string, unknown> = {};
    try { const parsed = JSON.parse(event.content); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) metadata = parsed; } catch { /* Malformed metadata remains an identifiable public author. */ }
    const npub = nip19.npubEncode(event.pubkey);
    const user = { pubkey: event.pubkey, npub, event, metadata, lastUpdated: event.created_at, image: typeof metadata.picture === 'string' ? metadata.picture : undefined,
      shortName: [metadata.name, metadata.display_name].find(value => typeof value === 'string' && value.trim()) ?? `${npub.slice(0, 8)}…${npub.slice(-4)}` };
    const text = [metadata.name, metadata.display_name, metadata.nip05, metadata.about, npub, event.pubkey].filter(value => typeof value === 'string').join(' ').toLocaleLowerCase();
    const bytes = event.content.length * 2 + JSON.stringify(event.tags).length * 2 + text.length * 2 + 1024;
    if (old) { this.profileBytes -= old.bytes; this.profiles.delete(event.pubkey); }
    while (this.profiles.size >= 2000 || this.profileBytes + bytes > 4 * 1024 * 1024) {
      const first = this.profiles.keys().next().value;
      if (!first) break;
      this.profileBytes -= this.profiles.get(first)!.bytes; this.profiles.delete(first);
    }
    if (bytes <= 4 * 1024 * 1024) { this.profiles.set(event.pubkey, { user, time: event.created_at, id: event.id, bytes, text }); this.profileBytes += bytes; }
    return user;
  }
  async resolveIdentifier(value: string): Promise<{pubkey: string; relays: string[]} | null> {
    if (/^[a-f0-9]{64}$/.test(value)) return { pubkey: value, relays: [] };
    try {
      const decoded = nip19.decode(value.replace(/^nostr:/, ''));
      if (decoded.type === 'npub') return { pubkey: decoded.data, relays: [] };
      if (decoded.type === 'nprofile') return { pubkey: decoded.data.pubkey, relays: relayUrls(decoded.data.relays, []) };
    } catch { /* A human-readable public identifier may follow. */ }
    const parts = /^([^\s@]{1,64})@([^\s@/?#:]{1,253})$/.exec(value);
    if (!parts) return null;
    const url = publicUrl(`https://${parts[2]}/.well-known/nostr.json?name=${encodeURIComponent(parts[1])}`);
    const data = await this.json(url);
    const pubkey = data?.names?.[parts[1]];
    if (!isPublicKey(pubkey)) return null;
    let relays: string[] = [];
    try { relays = relayUrls(data.relays?.[pubkey], []); } catch { /* Malformed hints do not invalidate the signed identity's lookup. */ }
    return { pubkey, relays };
  }
  async user(request: unknown) {
    const raw = typeof request === 'string' ? request : (request as any)?.pubkey;
    if (typeof raw !== 'string') throw new Error('invalid-pubkey');
    const identity = await this.resolveIdentifier(raw);
    if (!identity) throw new Error('invalid-pubkey');
    const hints = typeof request === 'object' && request ? relayUrls((request as any).relays, []) : [];
    const event = identity.relays.length || hints.length
      ? (await this.query([...new Set([...hints, ...identity.relays])], [{ kinds: [0], authors: [identity.pubkey], limit: 1 }])).events.reduce<Event | null>((best, e) => !best || newer(e, best) ? e : best, null)
      : await this.metadata(identity.pubkey, 0);
    if (event) return this.index(event);
    const npub = nip19.npubEncode(identity.pubkey);
    return { pubkey: identity.pubkey, npub, metadata: {}, lastUpdated: 0, shortName: `${npub.slice(0, 8)}…${npub.slice(-4)}` };
  }
  async searchLocal(term: string, limit = 20): Promise<any[]> {
    if (typeof term !== 'string') throw new Error('invalid-search');
    this.seeded ??= (async () => {
      const events = await localRelay.query({ kinds: [0], limit: 1000 });
      for (let i = 0; i < events.length; i++) { this.check(); this.index(events[i]); if (i % 8 === 7 || events[i].content.length > 16000) await pause(); }
    })().catch(error => { this.seeded = undefined; throw error; });
    await this.seeded; this.check();
    const words = term.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const result: any[] = [];
    for (const entry of this.profiles.values()) if (words.every(word => entry.text.includes(word))) { result.push(entry.user); if (result.length >= limit) break; }
    return result;
  }
  async searchRemote(term: string, limit = 20): Promise<any[]> {
    if (typeof term !== 'string') throw new Error('invalid-search');
    if (!term.trim()) return [];
    const list = await this.list('loadSearchRelays', this.account);
    const relays = list.items.length ? list.items : ['wss://relay.vertexlab.io/', 'wss://search.nostrarchives.com/'];
    const events = (await this.query(relays, [{ kinds: [0], search: term.trim(), limit }], 4000)).events;
    const users = new Map<string, any>();
    for (const event of events) { users.set(event.pubkey, this.index(event)); if (users.size >= limit) break; }
    return [...users.values()];
  }
  async findAuthors(term: string, options: any = {}) {
    if (typeof term !== 'string' || !options || typeof options !== 'object') throw new Error('invalid-search');
    const limit = Number.isSafeInteger(options.limit) && options.limit >= 0 ? options.limit : 20;
    if (limit === 0) return [];
    const [followList, muteList] = await Promise.all([this.list('loadFollowsList', this.account), this.list('loadMuteList', this.account)]);
    const follows = new Set<string>(followList.items), muted = new Set(muteList.items.filter(item => item.label === 'pubkey').map(item => item.value));
    const users = new Map<string, any>();
    const normalized = term.trim();
    if (/^[a-f0-9]{64}$/.test(normalized) || /^(?:nostr:)?(?:npub|nprofile)1/.test(normalized) || options.nip05 === true && normalized.includes('@')) {
      const user = await this.user(normalized); users.set(user.pubkey, user);
    } else if (normalized) {
      for (const user of await this.searchLocal(normalized, Infinity)) users.set(user.pubkey, user);
      if (options.remote === true) for (const user of await this.searchRemote(normalized, limit)) users.set(user.pubkey, user);
    } else {
      const keys = [...follows].filter(pubkey => !muted.has(pubkey)).slice(0, limit);
      let offset = 0;
      await Promise.all(Array.from({ length: Math.min(keys.length, 4) }, async () => { while (offset < keys.length) { const user = await this.user(keys[offset++]); users.set(user.pubkey, user); } }));
    }
    const ranked = [...users.values()].filter(user => !muted.has(user.pubkey)).sort((a, b) => Number(follows.has(b.pubkey)) - Number(follows.has(a.pubkey)) ||
      Number(String(b.metadata?.name ?? '').toLocaleLowerCase().startsWith(normalized.toLocaleLowerCase())) - Number(String(a.metadata?.name ?? '').toLocaleLowerCase().startsWith(normalized.toLocaleLowerCase()))).slice(0, limit);
    const result: any[] = [];
    for (const user of ranked) {
      this.check();
      const text = (key: string) => typeof user.metadata?.[key] === 'string' ? user.metadata[key] : '';
      let nip05 = text('nip05');
      if (options.nip05 === true && nip05) {
        try { if ((await this.resolveIdentifier(nip05))?.pubkey !== user.pubkey) nip05 = ''; }
        catch { this.check(); nip05 = ''; }
      }
      result.push({ pubkey: user.pubkey, name: text('name'), display_name: text('display_name'), picture: text('picture'), nip05, follows: follows.has(user.pubkey) });
    }
    return result;
  }
}
