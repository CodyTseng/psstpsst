import { createStore } from 'zustand/vanilla';
import { matchFilters, type Event } from 'nostr-tools';
import { NappletNetwork } from '@/services/napplet/network';
import { parseManifest } from '@/services/napplet/protocol';
import { fromNapplet, parseSite, type ExploreEntry } from './model';
import { APPLICATION_DISCOVERY_SOURCES, APPLICATION_QUERY_LIMIT } from './catalogue-relays';
import { RelayTimeline, compareTimelineEvents } from '@/services/relay/relay-timeline';

/** Verify bounded relay results without blocking a frame with a batch of signatures. */
export async function discoveryEntries(events: Event[]): Promise<ExploreEntry[]> {
  const entries = new Map<string, ExploreEntry>();
  for (let i = 0; i < Math.min(events.length, 500); i++) {
    if (i % 4 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    try {
      const event = events[i];
      const app = [5129, 15129, 35129].includes(event.kind)
        ? fromNapplet(parseManifest(event)) : parseSite(event);
      const previous = entries.get(app.key)?.manifest;
      if (!previous || event.created_at > previous.created_at ||
        (event.created_at === previous.created_at && event.id < previous.id)) entries.set(app.key, app);
    } catch { /* Ignore unsupported or invalid public manifests. */ }
  }
  return [...entries.values()].sort(compare);
}

export type ApplicationAddressCache = { account: string | null; entries: ExploreEntry[] };
const DISPLAY_PAGE_SIZE = 20;
const RELAY_PAGE_SIZE = APPLICATION_QUERY_LIMIT;
const CACHE_MS = 5 * 60 * 1000;
const yieldFrame = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const compare = (a: ExploreEntry, b: ExploreEntry) => compareTimelineEvents(a.manifest!, b.manifest!);
const createTimeline = () => new RelayTimeline(APPLICATION_DISCOVERY_SOURCES.map(source => ({
  urls: source.relays, filter: { kinds: source.kinds },
})), RELAY_PAGE_SIZE);

/** Discovery owns application parsing and the visible window; RelayTimeline owns event pagination. */
export class ApplicationDiscovery {
  readonly store = createStore(() => ({
    addressCache: { account: null, entries: [] } as ApplicationAddressCache,
    entries: [] as ExploreEntry[], visibleEntries: [] as ExploreEntry[], loading: false, loadingMore: false, loaded: false, error: false, hasMore: false,
  }));
  private timeline = createTimeline();
  private shown = new Set<string>();
  private catalogue = new Map<string, ExploreEntry>();
  private cached: ExploreEntry[] = [];
  private parsed = new Map<string, ExploreEntry | undefined>();
  private updatedAt = 0;
  private pending?: Promise<void>;
  private pendingRefresh?: Promise<void>;

  load(account: string, refresh = false): Promise<void> {
    if (refresh && this.pendingRefresh) return this.pendingRefresh;
    if (this.pending) {
      if (!refresh) return this.pending;
      const queued = this.pending.then(() => this.reload(account));
      this.pendingRefresh = queued;
      void queued.finally(() => { if (this.pendingRefresh === queued) this.pendingRefresh = undefined; });
      return queued;
    }
    if (!refresh && this.updatedAt && Date.now() - this.updatedAt < CACHE_MS) return Promise.resolve();
    return this.reload(account);
  }

  private reload(account: string): Promise<void> {
    this.timeline.dispose();
    this.timeline = createTimeline();
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

  private async remember(events: Event[]) {
    const missing = events.filter(event => !this.parsed.has(event.id));
    if (!missing.length) return;
    for (const event of missing) this.parsed.set(event.id, undefined);
    const changed = new Map<string, ExploreEntry>();
    for (const entry of await discoveryEntries(missing)) {
      this.parsed.set(entry.manifest!.id, entry);
      const previous = this.catalogue.get(entry.key);
      if (!previous || compare(entry, previous) < 0) {
        this.catalogue.set(entry.key, entry);
        changed.set(entry.key, entry);
      }
    }
    if (changed.size) {
      const incoming = [...changed.values()].sort(compare);
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
    this.store.setState(refresh ? { loading: true, error: false } : { loadingMore: true, error: false });
    const request = (async () => {
      let network: NappletNetwork | undefined;
      const page: ExploreEntry[] = [];
      try {
        await yieldFrame();
        let error = false;
        let hasMore = true;
        while (page.length < DISPLAY_PAGE_SIZE && hasMore && !error) {
          const result = await this.timeline.next(async (relay, filter, signal) => {
            network ??= new NappletNetwork(account);
            const result = await network.query([relay], [filter], signal);
            await this.remember(result.events.filter(event => matchFilters([filter], event)));
            return result;
          }, DISPLAY_PAGE_SIZE - page.length);
          await this.remember(result.events);
          for (const event of result.events) {
            const entry = this.parsed.get(event.id);
            if (entry && !this.shown.has(entry.key)) {
              this.shown.add(entry.key);
              page.push(entry);
            }
          }
          error = result.incomplete;
          hasMore = result.hasMore;
        }
        if (!refresh || page.length || !error) {
          const visibleEntries = refresh ? page : [...this.store.getState().visibleEntries, ...page];
          this.store.setState({ entries: this.cached, visibleEntries, loaded: true, error, hasMore });
          if (!error) this.updatedAt = Date.now();
        } else this.store.setState({ error: true });
      } catch { this.store.setState({ error: true }); }
      finally {
        network?.destroy();
        this.store.setState({ loading: false, loadingMore: false });
      }
    })();
    this.pending = request;
    void request.finally(() => { if (this.pending === request) this.pending = undefined; });
    return request;
  }
}

const discovery = new ApplicationDiscovery();
export const discoveryStore = discovery.store;
export function discoverApplications(account: string, refresh = false) { return discovery.load(account, refresh); }
export function loadMoreApplications(account: string) { return discovery.loadMore(account); }

/** Exact-address results remain separate from the curated discovery catalogue. */
export function cacheApplicationAddress(account: string, entry: ExploreEntry) {
  discoveryStore.setState(state => ({ addressCache: { account,
    entries: [entry, ...(state.addressCache.account === account ? state.addressCache.entries : []).filter(app => app.key !== entry.key)].slice(0, 64),
  } }));
}
