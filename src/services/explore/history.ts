import { createStore } from 'zustand/vanilla';
import { forget, readHistoryPage, type HistoryCursor } from './repository';
import type { ExploreEntry } from './model';
import { updateApplicationMetadata } from './application-event';
import { subscribeApplicationChanges } from './application-changes';

/** A history reader belongs to one mounted page, independently of Favorites startup. */
export class ExploreHistory {
  readonly store = createStore(() => ({ entries: [] as ExploreEntry[], loaded: false, loading: false, hasMore: true, error: null as string | null }));
  private cursor?: HistoryCursor;
  private pending?: Promise<void>;
  private generation = 0;
  private active = false;
  private removed = new Set<string>();
  private stopMetadata?: () => void;

  constructor(private readonly account: string) {}

  open(): Promise<void> {
    this.active = true;
    this.stopMetadata ??= subscribeApplicationChanges(metadata => {
      this.store.setState(state => {
        const entries = updateApplicationMetadata(state.entries, metadata);
        return entries === state.entries ? state : { entries };
      });
    }, key => this.store.getState().entries.find(entry => entry.key === key));
    return this.loadMore();
  }

  loadMore(): Promise<void> {
    if (!this.active) return Promise.resolve();
    if (this.pending) return this.pending;
    if (!this.store.getState().hasMore) return Promise.resolve();
    const generation = this.generation;
    this.store.setState({ loading: true, error: null });
    const work = (async () => {
      try {
        const page = await readHistoryPage(this.account, this.cursor);
        if (generation !== this.generation) return;
        this.cursor = page.cursor;
        this.store.setState(state => {
          const seen = new Set(state.entries.map(entry => entry.key));
          return { entries: [...state.entries, ...page.entries.filter(entry => !seen.has(entry.key) && !this.removed.has(entry.key))],
            loaded: true, hasMore: page.hasMore };
        });
      } catch {
        if (generation === this.generation) this.store.setState({ error: 'napplets.request_failed' });
      } finally {
        if (generation === this.generation) { this.pending = undefined; this.store.setState({ loading: false }); }
      }
    })();
    this.pending = work;
    return work;
  }

  async remove(entry: ExploreEntry) {
    const generation = this.generation;
    this.removed.add(entry.key);
    this.store.setState(state => ({ entries: state.entries.filter(app => app.key !== entry.key) }));
    try { await forget(this.account, entry.key); }
    catch (error) {
      if (generation === this.generation) {
        this.removed.delete(entry.key);
        this.store.setState(state => ({ entries: [...state.entries, entry].sort((a, b) =>
          b.lastUsedAt! - a.lastUsedAt! || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)) }));
      }
      throw error;
    }
  }

  reset() {
    this.stopMetadata?.(); this.stopMetadata = undefined;
    this.active = false;
    this.generation++;
    this.pending = undefined;
    this.cursor = undefined;
    this.removed.clear();
    this.store.setState({ entries: [], loaded: false, loading: false, hasMore: true, error: null });
  }
}
