import { matchFilters, type Event, type Filter } from 'nostr-tools';

import { normalizeRelayUrl } from '@/lib/nostr/relay-url';
import { relayPool, type QueryCompletion } from './relay-pool';

type Request = {
  filters: Filter[];
  onEvent?: (event: Event) => void;
  onComplete?: (result: QueryCompletion) => void;
  resolve: (events: Event[]) => void;
  reject: (error: unknown) => void;
};

const pending = new Map<string, Request[]>();
const MAX_REQUESTS_PER_BATCH = 32;
let scheduled = false;

/** Share a bounded subscription for profile and command requests queued together.
 * Each consumer retains its filters, streamed events and completion outcome. */
export function queryMetadataRelay(
  relay: string, filters: Filter[], onEvent?: (event: Event) => void,
  onComplete?: (result: QueryCompletion) => void,
): Promise<Event[]> {
  return new Promise((resolve, reject) => {
    const url = normalizeRelayUrl(relay);
    const requests = pending.get(url) ?? [];
    requests.push({ filters, onEvent, onComplete, resolve, reject });
    pending.set(url, requests);
    if (scheduled) return;
    scheduled = true;
    setTimeout(flush, 0);
  });
}

function flush(): void {
  const batch = new Map(pending);
  pending.clear();
  scheduled = false;
  for (const [relay, requests] of batch) {
    for (let start = 0; start < requests.length; start += MAX_REQUESTS_PER_BATCH) {
      void run(relay, requests.slice(start, start + MAX_REQUESTS_PER_BATCH));
    }
  }
}

async function run(relay: string, requests: Request[]): Promise<void> {
  // Only union authors for otherwise identical filters. Kinds keep separate
  // limits, and batching never adds an unrequested kind/author combination.
  const groups = new Map<string, { filter: Filter; authors: Set<string>; limitPerAuthor?: number }>();
  for (const request of requests) {
    for (const filter of request.filters) {
      const { authors = [], limit, ...rest } = filter;
      const limitPerAuthor = limit === undefined ? undefined : limit / authors.length;
      const key = JSON.stringify([rest, limitPerAuthor]);
      let group = groups.get(key);
      if (!group) {
        group = { filter: rest, authors: new Set(), limitPerAuthor };
        groups.set(key, group);
      }
      for (const author of authors) group.authors.add(author);
    }
  }
  const filters = [...groups.values()].map(({ filter, authors, limitPerAuthor }) => ({
    ...filter, authors: [...authors],
    ...(limitPerAuthor === undefined ? {} : { limit: limitPerAuthor * authors.size }),
  }));
  try {
    const events = await relayPool.query({
      relays: [relay], filters, timeoutMs: 10_000, label: 'peer-metadata',
      onComplete: result => { for (const request of requests) request.onComplete?.(result); },
      onEvent: event => {
        for (const request of requests) {
          if (request.onEvent && matchFilters(request.filters, event)) request.onEvent(event);
        }
      },
    });
    for (const request of requests) request.resolve(events.filter(event => matchFilters(request.filters, event)));
  } catch (error) {
    for (const request of requests) request.reject(error);
  }
}
