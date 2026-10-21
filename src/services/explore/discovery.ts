import { createStore } from 'zustand/vanilla';
import type { Event } from 'nostr-tools';
import { NappletNetwork } from '@/services/napplet/network';
import { parseManifest } from '@/services/napplet/protocol';
import { fromNapplet, parseSite, type ExploreEntry } from './model';
import { APPLICATION_CATALOGUE_SOURCES } from './catalogue-relays';
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

const DISPLAY_PAGE_SIZE = 20;
const RELAY_PAGE_SIZE = 100;
const CACHE_MS = 5 * 60 * 1000;
const yieldFrame = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const compare = (a: ExploreEntry, b: ExploreEntry) => compareTimelineEvents(a.manifest!, b.manifest!);
const createTimeline = () => new RelayTimeline(APPLICATION_CATALOGUE_SOURCES.map(source => ({
  urls: source.relays, filter: { kinds: source.kinds },
})), RELAY_PAGE_SIZE);

/** Discovery owns application parsing and the visible window; RelayTimeline owns event pagination. */
export class ApplicationDiscovery {
  readonly store = createStore(() => ({
    entries: [] as ExploreEntry[], loading: false, loadingMore: false, loaded: false, error: false, hasMore: false,
  }));
  private timeline = createTimeline();
  private shown = new Set<string>();
  private updatedAt = 0;
  private pending?: Promise<void>;

  load(account: string, refresh = false): Promise<void> {
    if (this.pending) return this.pending;
    if (!refresh && this.updatedAt && Date.now() - this.updatedAt < CACHE_MS) return Promise.resolve();
    this.timeline.dispose();
    this.timeline = createTimeline();
    this.shown.clear();
    return this.read(account, true);
  }

  loadMore(account: string): Promise<void> {
    if (this.pending) return this.pending;
    const state = this.store.getState();
    if (!state.loaded || !state.hasMore || state.error) return Promise.resolve();
    return this.read(account, false);
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
          const result = await this.timeline.next((relay, filter, signal) => {
            network ??= new NappletNetwork(account);
            return network.query([relay], [filter], signal);
          }, DISPLAY_PAGE_SIZE - page.length);
          for (const entry of await discoveryEntries(result.events)) {
            if (!this.shown.has(entry.key)) {
              this.shown.add(entry.key);
              page.push(entry);
            }
          }
          error = result.incomplete;
          hasMore = result.hasMore;
        }
        if (!refresh || page.length || !error) {
          const entries = refresh ? page : [...this.store.getState().entries, ...page];
          this.store.setState({ entries, loaded: true, error, hasMore });
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
export const discoverApplications = (account: string, refresh = false) => discovery.load(account, refresh);
export const loadMoreApplications = (account: string) => discovery.loadMore(account);
