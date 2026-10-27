import type { Event, EventTemplate, Filter } from 'nostr-tools';
import { assertNotAborted } from '@/platform/abort';
import { localRelay } from '@/services/local-relay';
import { localFilters } from '@/services/local-relay/filters';
import { relayFilters } from '@/services/napplet/filters';
import { NappletNetwork, relayUrls } from '@/services/napplet/network';

const privateKinds = new Set([4, 13, 14, 15, 1059]);
/** Streams belong to a document; accepted public events belong to the device cache. */
export class ExploreStreams {
  private streams = new Map<string, () => void>();
  constructor(private network: NappletNetwork, private diagnostic: (phase: string, details: object) => void = () => {}) {}
  close(id: string) { this.streams.get(id)?.(); this.streams.delete(id); }
  clear() { for (const id of this.streams.keys()) this.close(id); }
  async open(method: string, args: any[], signal: AbortSignal, send: (message: object) => Promise<void>, auth: (event: EventTemplate) => Promise<Event>) {
    const [id, input, filterInput, options] = args;
    if (typeof id !== 'string' || !id || this.streams.has(id)) throw new Error('invalid-subscription');
    const filters = method === 'storeSubscribe' ? localFilters(input) : relayFilters(filterInput);
    let closed = false;
    const cleanups: (() => void)[] = [];
    const close = () => {
      if (closed) return;
      closed = true; for (const cleanup of cleanups.splice(0)) cleanup();
      signal.removeEventListener('abort', close); this.streams.delete(id);
    };
    const emit = (message: object) => { if (!closed) void send({ type: 'stream', streamId: id, ...message }).catch(close); };
    const fail = (error: unknown) => {
      const reason = error instanceof Error ? error.message : 'subscription-failed';
      this.diagnostic('failed', { streamId: id, error: reason });
      emit({ phase: 'closed', error: reason }); close();
    };
    this.streams.set(id, close); signal.addEventListener('abort', close, { once: true });
    if (signal.aborted) { close(); return; }
    try {
      if (method === 'storeSubscribe') { cleanups.push(localRelay.subscribe(filters, event => emit({ phase: 'event', event }))); return; }
      const groups = new Map<string, Filter[]>();
      if (method === 'outboxSubscribe') {
        if (!filters.length || filters.some(filter => !Array.isArray(filter.authors) || !filter.authors.length || filter.authors.some(author => typeof author !== 'string')))
          throw new Error('outbox-authors-required');
        const memberships = new Map<string, Set<number>>();
        filters.forEach((filter, index) => { for (const author of filter.authors!) {
          const indices = memberships.get(author) ?? new Set<number>();
          indices.add(index); memberships.set(author, indices);
        } });
        const routes = await this.network.outboxRoutes([...memberships.keys()], signal);
        assertNotAborted(signal); if (closed) return;
        for (const [url, authors] of routes) {
          const routed = new Map<number, Filter>();
          for (const author of authors) for (const index of memberships.get(author)!) {
            let target = routed.get(index);
            if (!target) { target = { ...filters[index], authors: [] }; routed.set(index, target); }
            target.authors!.push(author);
          }
          groups.set(url, [...routed.values()]);
        }
      } else {
        const relays = relayUrls(input, []);
        if (!relays.length) throw new Error('invalid-relays');
        // A direct subscription uses exactly the requested relays and filters.
        for (const url of relays) groups.set(url, filters);
      }
      assertNotAborted(signal);
      if (closed) return;
      this.diagnostic('routes', { streamId: id, method, filters: filters.length, relays: groups.size,
        authors: new Set(filters.flatMap(filter => filter.authors ?? [])).size,
        requested: filters.map(({ kinds, since, until, limit }) => ({ kinds, since, until, limit })) });
      const seen = new Set<string>(), reasons: Record<string, string> = {};
      let work = Promise.resolve();
      for (const [url, routed] of groups) {
        let received = 0, delivered = 0;
        const cleanup = this.network.subscribe({ relays: [url], filters: routed, abort: signal,
          label: typeof options?.label === 'string' ? options.label : undefined,
          timeoutMs: Number.isFinite(options?.maxEoseTimeout) && options.maxEoseTimeout > 0 ? options.maxEoseTimeout : 20000,
          onEvent: event => {
            if (closed || seen.has(event.id)) return;
            if (++received === 1) this.diagnostic('received', { streamId: id, relay: url, kind: event.kind });
            if (seen.size >= 8192) seen.delete(seen.values().next().value!);
            seen.add(event.id);
            work = work.then(async () => {
              await new Promise<void>(resolve => setTimeout(resolve, 0));
              if (closed) return;
              if (!privateKinds.has(event.kind)) await localRelay.add(event);
              if (!closed) { await send({ type: 'stream', streamId: id, phase: 'event', event }); delivered++; }
            }).catch(fail);
          },
          onEnd: results => {
            this.diagnostic('readEnd', { streamId: id, relay: url, received, delivered, results });
            if (!results.some(result => result.status === 'eose' && !result.reason)) return;
            work = work.then(async () => {
              if (!closed) {
                await send({ type: 'stream', streamId: id, phase: 'eose', url });
                this.diagnostic('delivered', { streamId: id, relay: url, received, delivered });
              }
            }).catch(fail);
          },
          onRelayClose: (relay, reason) => {
            this.diagnostic('relayClosed', { streamId: id, relay, reason, received, delivered });
            reasons[relay] = reason; emit({ phase: 'relayClosed', url: relay, reason });
            if (Object.keys(reasons).length === groups.size) void work.then(() => {
              if (method === 'outboxSubscribe') emit({ phase: 'closed', reasons });
              close();
            });
          },
        }, auth);
        cleanups.push(cleanup);
        if (closed) { cleanup(); break; }
      }
    } catch (error) { close(); throw error; }
  }
}
