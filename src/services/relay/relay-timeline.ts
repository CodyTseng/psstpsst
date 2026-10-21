import { matchFilters, type Event, type Filter } from 'nostr-tools';
import { normalizeRelayUrls } from '@/lib/nostr/relay-url';
import { assertNotAborted, linkAbort } from '@/platform/abort';

export type RelayTimelineRequest = { urls: string[]; filter: Omit<Filter, 'limit'> };
export type RelayTimelineQuery = (relay: string, filter: Filter, signal: AbortSignal) => Promise<{
  events: Event[]; incomplete: boolean; error?: string;
}>;
export type RelayTimelinePage = { events: Event[]; hasMore: boolean; incomplete: boolean };

export const compareTimelineEvents = (a: Event, b: Event) =>
  b.created_at - a.created_at || a.id.localeCompare(b.id);

type Stream = {
  relay: string; filter: Filter; until?: number; boundary: Set<string>;
  events: Event[]; offset: number; exhausted: boolean; failed: boolean;
};

/** Cache-first event pagination, with an independent cursor for every relay/query pair. */
export class RelayTimeline {
  private streams: Stream[];
  private lastId?: string;
  private pending?: Promise<RelayTimelinePage>;
  private lifetime = new AbortController();

  constructor(requests: RelayTimelineRequest[], private requestLimit = 100) {
    if (!Number.isSafeInteger(requestLimit) || requestLimit < 1) throw new Error('invalid-page-size');
    this.streams = requests.flatMap(({ urls, filter }) => normalizeRelayUrls(urls).map(relay => ({
      relay, filter: { ...filter }, until: filter.until, boundary: new Set<string>(),
      events: [], offset: 0, exhausted: false, failed: false,
    })));
  }

  /** Transport verifies signatures; callers own domain parsing and display state. */
  next(query: RelayTimelineQuery, limit = 20, signal?: AbortSignal): Promise<RelayTimelinePage> {
    if (this.pending) return this.pending;
    if (!Number.isSafeInteger(limit) || limit < 1) return Promise.reject(new Error('invalid-page-size'));
    const request = this.read(query, limit, signal);
    this.pending = request;
    void request.finally(() => { if (this.pending === request) this.pending = undefined; }).catch(() => {});
    return request;
  }

  dispose() { this.lifetime.abort(); }

  private async fill(source: Stream, query: RelayTimelineQuery, signal: AbortSignal) {
    try {
      const filter = { ...source.filter, limit: this.requestLimit,
        ...(source.until === undefined ? {} : { until: source.until }) };
      const result = await query(source.relay, filter, signal);
      assertNotAborted(signal);
      if (result.error) throw new Error(result.error);
      const events = result.events.filter(event => Number.isSafeInteger(event.created_at) &&
        event.created_at >= 0 && matchFilters([filter], event));
      const fresh = events.filter(event => !source.boundary.has(event.id));
      source.failed = result.incomplete;
      if (!fresh.length) {
        // A fixed-size NIP-01 filter cannot exclude IDs at a saturated second. Never silently skip it.
        source.failed ||= events.length >= this.requestLimit;
        source.exhausted = !source.failed;
        return;
      }
      const until = Math.min(...events.map(event => event.created_at));
      const boundary = until === source.until ? new Set(source.boundary) : new Set<string>();
      for (const event of events) if (event.created_at === until) boundary.add(event.id);
      source.until = until;
      source.boundary = boundary;
      source.events = fresh.sort(compareTimelineEvents);
      source.offset = 0;
    } catch {
      assertNotAborted(signal);
      source.failed = true;
    }
  }

  private async read(query: RelayTimelineQuery, limit: number, signal?: AbortSignal): Promise<RelayTimelinePage> {
    const linked = linkAbort(signal ? [this.lifetime.signal, signal] : [this.lifetime.signal]);
    // Buffers are immutable between fills, so cancellation rollback copies only the small cursor set.
    const before = this.streams.map(source => ({ ...source }));
    const lastId = this.lastId;
    try {
      assertNotAborted(linked.signal);
      const events: Event[] = [];
      let processed = 0;
      while (events.length < limit) {
        const empty = this.streams.filter(source => source.offset === source.events.length && !source.exhausted && !source.failed);
        if (empty.length) await Promise.all(empty.map(source => this.fill(source, query, linked.signal)));
        assertNotAborted(linked.signal);
        let next: Stream | undefined;
        for (const source of this.streams) {
          if (source.offset < source.events.length && (!next ||
            compareTimelineEvents(source.events[source.offset], next.events[next.offset]) < 0)) next = source;
        }
        if (!next) break;
        const event = next.events[next.offset++];
        // Equal IDs are adjacent in the ordered merge; no unbounded history of seen IDs is needed.
        if (event.id !== this.lastId) {
          events.push(event);
          this.lastId = event.id;
        }
        if (++processed % 100 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      assertNotAborted(linked.signal);
      return { events, incomplete: this.streams.some(source => source.failed),
        hasMore: this.streams.some(source => source.offset < source.events.length || !source.exhausted) };
    } catch (error) {
      if (linked.signal.aborted) {
        this.streams = before;
        this.lastId = lastId;
      }
      throw error;
    } finally { linked.dispose(); }
  }
}
