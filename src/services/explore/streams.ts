import type { Event, EventTemplate, Filter } from 'nostr-tools';
import { assertNotAborted } from '@/platform/abort';
import { localRelay } from '@/services/local-relay';
import { localFilters } from '@/services/local-relay/filters';
import { NappletNetwork, relayUrls } from '@/services/napplet/network';

const privateKinds = new Set([4, 13, 14, 15, 1059]);
/** Streams belong to a document; accepted public events belong to the device cache. */
export class ExploreStreams {
  private streams = new Map<string, () => void>();
  constructor(private network: NappletNetwork) {}
  close(id: string) { this.streams.get(id)?.(); this.streams.delete(id); }
  clear() { for (const id of this.streams.keys()) this.close(id); }
  async open(method: string, args: any[], signal: AbortSignal, send: (message: object) => Promise<void>, auth: (event: EventTemplate) => Promise<Event>) {
    const [id, input, filterInput, options] = args;
    if (typeof id !== 'string' || !id || id.length > 64 || this.streams.has(id) || this.streams.size >= 8) throw new Error('invalid-subscription');
    const filters = localFilters(method === 'storeSubscribe' ? input : filterInput);
    let closed = false;
    const cleanups: (() => void)[] = [];
    const close = () => {
      if (closed) return;
      closed = true; for (const cleanup of cleanups.splice(0)) cleanup();
      signal.removeEventListener('abort', close); this.streams.delete(id);
    };
    const emit = (message: object) => { if (!closed) void send({ type: 'stream', streamId: id, ...message }).catch(close); };
    const fail = (error: unknown) => { emit({ phase: 'closed', error: error instanceof Error ? error.message : 'subscription-failed' }); close(); };
    this.streams.set(id, close); signal.addEventListener('abort', close, { once: true });
    if (signal.aborted) { close(); return; }
    try {
      if (method === 'storeSubscribe') { cleanups.push(localRelay.subscribe(filters, event => emit({ phase: 'event', event }))); return; }
      const groups = new Map<string, Filter[]>();
      const filterIndices = new WeakMap<Filter, number>();
      if (method === 'outboxSubscribe') {
        const authors = [...new Set(filters.flatMap(filter => filter.authors ?? []))];
        if (!authors.length || authors.length > 16 || filters.some(filter => !filter.authors?.length)) throw new Error('outbox-authors-required');
        for (let offset = 0; offset < authors.length; offset += 4) await Promise.all(authors.slice(offset, offset + 4).map(async author => {
          const relays = (await this.network.routes([author], 'write', false, signal)).slice(0, 2);
          assertNotAborted(signal); if (closed) throw new Error('subscription-closed');
          for (const url of relays) {
            const routed = groups.get(url) ?? [];
            for (let index = 0; index < filters.length; index++) {
              const filter = filters[index];
              if (!filter.authors!.includes(author)) continue;
              let target = routed.find(value => filterIndices.get(value) === index);
              if (!target) { target = { ...filter, authors: [] }; filterIndices.set(target, index); routed.push(target); }
              target.authors!.push(author);
            }
            groups.set(url, routed);
          }
        }));
      } else {
        const relays = relayUrls(input, []);
        if (!relays.length) throw new Error('invalid-relays');
        // A direct subscription uses exactly the requested relays and filters.
        for (const url of relays) groups.set(url, filters);
      }
      assertNotAborted(signal);
      if (closed) return;
      if (groups.size > 24) throw new Error('relay-quota-exceeded');
      const seen = new Set<string>(), reasons: Record<string, string> = {};
      let initial = true, pendingEose = groups.size, queued = 0, queuedBytes = 0, work = Promise.resolve();
      for (const [url, routed] of groups) {
        const cleanup = this.network.subscribe({ relays: [url], filters: routed, abort: signal,
          label: typeof options?.label === 'string' ? options.label.slice(0, 64) : undefined,
          timeoutMs: Math.max(1000, Math.min(Number(options?.maxEoseTimeout) || 20000, 30000)),
          onEvent: event => {
            if (closed || seen.has(event.id)) return;
            const bytes = event.content.length * 2 + JSON.stringify(event.tags).length * 2 + 512;
            if (queued >= 128 || queuedBytes + bytes > 4 * 1024 * 1024) { fail(new Error('subscription-overflow')); return; }
            queued++; queuedBytes += bytes;
            if (seen.size >= 8192) seen.delete(seen.values().next().value!);
            seen.add(event.id);
            const phase = initial ? 'initial' : 'event';
            work = work.then(async () => {
              await new Promise<void>(resolve => setTimeout(resolve, 0));
              if (closed) return;
              if (!privateKinds.has(event.kind)) await localRelay.add(event);
              if (!closed) await send({ type: 'stream', streamId: id, phase, event });
            }).catch(fail).finally(() => { queued--; queuedBytes -= bytes; });
          },
          onEose: () => { if (--pendingEose === 0) { initial = false; void work.then(() => emit({ phase: 'eose' })); } },
          onRelayClose: (relay, reason) => {
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
