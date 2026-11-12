import { createStore } from 'zustand/vanilla';
import { matchFilters, type Event } from 'nostr-tools';
import { ApplicationNetwork } from '@/services/applications/network';
import { parseApplicationEvents } from './application-event';
import { SUPPORTED_NAPP_DOMAINS, type ExploreEntry } from './model';
import { NAP_DOMAINS } from '@/services/napplet/protocol';
import { APPLICATION_DISCOVERY_SOURCES, APPLICATION_QUERY_LIMIT } from './catalogue-relays';
import { loadDiscoveryRelays } from './discovery-relays';
import { RelayTimeline, compareTimelineEvents } from '@/services/relay/relay-timeline';

/** Verify bounded relay results without blocking a frame with a batch of signatures. */
export async function discoveryEntries(events: Event[], eventRelays?: Map<string, string[]>): Promise<ExploreEntry[]> {
  return (await latestDiscoveryEntries(events, eventRelays)).filter(isSupported);
}

function isSupported(app: ExploreEntry): boolean {
  const domains: readonly string[] | undefined = app.kind === 'napp' ? SUPPORTED_NAPP_DOMAINS : app.kind === 'napplet' ? NAP_DOMAINS : undefined;
  return !domains || app.required.every(domain => domains.includes(domain));
}

// Retain unsupported versions internally so older supported releases cannot reappear.
async function latestDiscoveryEntries(events: Event[], eventRelays?: Map<string, string[]>): Promise<ExploreEntry[]> {
  const entries = new Map<string, ExploreEntry>();
  for (const app of await parseApplicationEvents(events.slice(0, 500).filter(event => [15128, 35128, 15129, 35129, 35130].includes(event.kind)))) {
    if (!app?.manifest) continue;
    const event = app.manifest, previous = entries.get(app.key)?.manifest;
    if (!previous || event.created_at > previous.created_at ||
      event.created_at === previous.created_at && event.id < previous.id) {
      const relays = eventRelays?.get(event.id);
      entries.set(app.key, relays ? { ...app, eventRelays: relays, release: app.release ? { ...app.release, eventRelays: relays } : undefined } : app);
    }
  }
  return [...entries.values()].sort(compare);
}

export type ApplicationDiscoveryScope = 'all' | 'napps';
export type ApplicationAddressCache = { account: string | null; entries: ExploreEntry[] };
const DISPLAY_PAGE_SIZE = 20;
const RELAY_PAGE_SIZE = APPLICATION_QUERY_LIMIT;
const MAX_QUERY_PAGES_PER_READ = 3;
const CACHE_MS = 5 * 60 * 1000;
const yieldFrame = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const compare = (a: ExploreEntry, b: ExploreEntry) => compareTimelineEvents(a.manifest!, b.manifest!);
const createTimeline = (scope: ApplicationDiscoveryScope, sources = APPLICATION_DISCOVERY_SOURCES) => new RelayTimeline(sources.flatMap(source => {
  const kinds = scope === 'napps' ? source.kinds.filter(kind => kind === 35130) : source.kinds;
  return kinds.length ? [{
    urls: source.relays, filter: { kinds },
  }] : [];
}), RELAY_PAGE_SIZE);

/** Discovery owns application parsing and the visible window; RelayTimeline owns event pagination. */
export class ApplicationDiscovery {
  readonly store = createStore(() => ({
    addressCache: { account: null, entries: [] } as ApplicationAddressCache,
    entries: [] as ExploreEntry[], visibleEntries: [] as ExploreEntry[], loading: false, loadingMore: false, loaded: false, error: false, hasMore: false, queryPages: 0,
  }));
  private timeline: RelayTimeline;
  private shown = new Set<string>();
  private catalogue = new Map<string, ExploreEntry>();
  private cached: ExploreEntry[] = [];
  private parsed = new Map<string, ExploreEntry | undefined>();
  private updatedAt = 0;
  private queryPages = 0;
  private account?: string;
  private sourcesKey = JSON.stringify(APPLICATION_DISCOVERY_SOURCES);
  private sourcesRevision = 0;
  private readSourcesRevision = 0;
  private pending?: Promise<void>;
  private pendingRefresh?: Promise<void>;

  constructor(private readonly scope: ApplicationDiscoveryScope = 'all') {
    this.timeline = createTimeline(scope);
  }

  load(account: string, refresh = false): Promise<void> {
    this.account = account;
    if (refresh && this.pendingRefresh) return this.pendingRefresh;
    if (this.pending) {
      if (!refresh) return this.pending;
      const queued = this.pending.then(() => this.reload(account));
      this.pendingRefresh = queued;
      const settled = () => {
        if (this.pendingRefresh === queued) this.pendingRefresh = undefined;
        this.publishIdle();
      };
      void queued.then(settled, settled);
      return queued;
    }
    if (!refresh && this.updatedAt && Date.now() - this.updatedAt < CACHE_MS) return Promise.resolve();
    return this.reload(account);
  }

  refreshSources(account: string): void {
    this.sourcesRevision++;
    if (this.account) void this.load(account, true);
  }

  private reload(account: string): Promise<void> {
    this.timeline.dispose();
    this.shown.clear();
    this.catalogue.clear();
    this.cached = [];
    this.parsed.clear();
    return this.read(account, true);
  }

  loadMore(account: string): Promise<void> {
    if (this.pendingRefresh) return this.pendingRefresh;
    if (this.pending) return this.pending;
    const state = this.store.getState();
    if (!state.loaded || !state.hasMore || state.error) return Promise.resolve();
    return this.read(account, false);
  }

  private async remember(events: Event[], eventRelays?: Map<string, string[]>) {
    const missing = events.filter(event => !this.parsed.has(event.id));
    if (!missing.length) return;
    for (const event of missing) this.parsed.set(event.id, undefined);
    const changed = new Map<string, ExploreEntry>();
    for (const entry of await latestDiscoveryEntries(missing, eventRelays)) {
      this.parsed.set(entry.manifest!.id, entry);
      setTimeout(() => { void import('./application-cache').then(cache => cache.cacheApplicationEvent(entry)).catch(() => {}); }, 0);
      const previous = this.catalogue.get(entry.key);
      if (!previous || compare(entry, previous) < 0) {
        this.catalogue.set(entry.key, entry);
        changed.set(entry.key, entry);
      }
    }
    if (changed.size) {
      const incoming = [...changed.values()].filter(isSupported).sort(compare);
      const previous = this.cached.filter(entry => !changed.has(entry.key));
      const merged: ExploreEntry[] = [];
      let i = 0, j = 0;
      while (i < previous.length && j < incoming.length) {
        merged.push(compare(previous[i], incoming[j]) <= 0 ? previous[i++] : incoming[j++]);
      }
      this.cached = merged.concat(previous.slice(i), incoming.slice(j));
    }
    // Retain parsing results for recent relay buffers, independently of the searchable catalogue.
    while (this.parsed.size > RELAY_PAGE_SIZE * 4) this.parsed.delete(this.parsed.keys().next().value!);
  }

  private read(account: string, refresh: boolean): Promise<void> {
    if (refresh) this.readSourcesRevision = this.sourcesRevision;
    this.store.setState(refresh ? { loading: true, error: false } : { loadingMore: true, error: false });
    const request = (async () => {
      let network: ApplicationNetwork | undefined;
      const page: ExploreEntry[] = [];
      let queried = 0;
      try {
        await yieldFrame();
        if (refresh) {
          const relays = await loadDiscoveryRelays();
          const sources = APPLICATION_DISCOVERY_SOURCES.map((source, index) => ({
            ...source, relays: index === 0 ? relays.napp : relays.napplet,
          }));
          const sourcesKey = JSON.stringify(sources);
          if (sourcesKey !== this.sourcesKey) {
            this.sourcesKey = sourcesKey;
            this.updatedAt = 0;
            this.queryPages = 0;
            this.store.setState({ entries: [], visibleEntries: [], loaded: false, hasMore: false });
          }
          this.timeline.dispose();
          this.timeline = createTimeline(this.scope, sources);
        }
        let error = false;
        let hasMore = true;
        while (page.length < DISPLAY_PAGE_SIZE && hasMore && !error) {
          const result = await this.timeline.next(async (relay, filter, signal) => {
            network ??= new ApplicationNetwork(account);
            const result = await network.query([relay], [filter], signal);
            queried++;
            this.queryPages++;
            await this.remember(result.events.filter(event => matchFilters([filter], event)), result.eventRelays);
            return result;
          }, DISPLAY_PAGE_SIZE - page.length);
          await this.remember(result.events);
          for (const event of result.events) {
            const entry = this.parsed.get(event.id);
            if (entry && isSupported(this.catalogue.get(entry.key) ?? entry) && !this.shown.has(entry.key)) {
              this.shown.add(entry.key);
              page.push(entry);
            }
          }
          error = result.incomplete;
          hasMore = result.hasMore;
          // Return control even when remote pages contain only invalid manifests.
          if (queried >= MAX_QUERY_PAGES_PER_READ) break;
        }
        if (!refresh || page.length || !error) {
          const visibleEntries = refresh ? page : [...this.store.getState().visibleEntries, ...page];
          this.store.setState({ entries: this.cached, visibleEntries, loaded: true, error, hasMore, queryPages: this.queryPages });
          if (!error) this.updatedAt = Date.now();
        } else this.store.setState({ error: true });
      } catch { this.store.setState({ error: true }); }
      finally {
        network?.destroy();
      }
    })();
    this.pending = request;
    const settled = () => {
      if (this.pending === request) this.pending = undefined;
      this.publishIdle();
    };
    void request.then(settled, settled);
    return request;
  }

  private publishIdle() {
    // An idle observer may immediately start the next read. Release both read
    // and queued-refresh ownership before publishing that transition.
    if (!this.pending && !this.pendingRefresh) {
      // Source edits are invalidations, independent of pull-to-refresh deduplication.
      // A read consumes only the revision it started with, including on failure.
      if (this.readSourcesRevision !== this.sourcesRevision && this.account) {
        void this.reload(this.account);
        return;
      }
      this.store.setState({ loading: false, loadingMore: false, queryPages: this.queryPages });
    }
  }
}

const discoveries = { all: new ApplicationDiscovery(), napps: new ApplicationDiscovery('napps') };
export const discoveryStore = discoveries.all.store;
export function getDiscoveryStore(scope: ApplicationDiscoveryScope = 'all') { return discoveries[scope].store; }
export function discoverApplications(account: string, refresh = false, scope: ApplicationDiscoveryScope = 'all') {
  return discoveries[scope].load(account, refresh);
}
export function loadMoreApplications(account: string, scope: ApplicationDiscoveryScope = 'all') {
  return discoveries[scope].loadMore(account);
}

/** Exact-address results remain separate from the curated discovery catalogue. */
export function cacheApplicationAddress(account: string, entry: ExploreEntry) {
  setTimeout(() => { void import('./application-cache').then(cache => cache.cacheApplicationEvent(entry)).catch(() => {}); }, 0);
  const previous = discoveryStore.getState().addressCache;
  const addressCache = { account, entries: [entry, ...(previous.account === account ? previous.entries : [])
    .filter(app => app.key !== entry.key)].slice(0, 64) };
  for (const discovery of Object.values(discoveries)) discovery.store.setState({ addressCache });
}

/** Reload active catalogues after a directory preference is committed. */
export function refreshDiscoverySources(account: string) {
  for (const discovery of Object.values(discoveries)) discovery.refreshSources(account);
}
