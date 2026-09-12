import type { Event, EventTemplate } from 'nostr-tools';

import { relayPool } from '../relay/relay-pool';
import { RelayQueryError } from '../relay/relay-query-error';

const PAGE_SIZE = 200;
const MAX_BOUNDARY_PAGE_SIZE = 3200;
const QUERY_TIMEOUT_MS = 8000;

type PollOptions = {
  accountPubkey: string;
  relays: string[];
  since: number;
  until: number;
  abort: AbortSignal;
  isCurrent: () => boolean;
  signAuth: (event: EventTemplate) => Promise<Event>;
  onReceived: (relayUrl: string, id: string) => void;
  onEvent: (event: Event) => Promise<void>;
};

/** Walk a fixed notification window without reading or advancing history cursors.
 * Each relay owns its boundary; a sparse replica cannot skip a busy replica's
 * messages. Short pages still need a follow-up because relays can cap the limit.
 * Memory is bounded by one page, apart from the caller's notification results.
 */
export async function pollRecentGiftWraps(options: PollOptions): Promise<string[]> {
  const pending = Array.from(new Set(options.relays), (url) => ({
    url, until: options.until, limit: PAGE_SIZE,
  }));
  const interrupted: string[] = [];
  const current = () => !options.abort.aborted && options.isCurrent();
  while (pending.length > 0 && current()) {
    // Rotate between relays so a large inbox cannot starve other replicas.
    const relay = pending.shift()!;
    let wireEose = false;
    const events = await relayPool.query({
      label: 'dm.notification-poll',
      relays: [relay.url],
      filter: {
        kinds: [1059], '#p': [options.accountPubkey],
        since: options.since, until: relay.until, limit: relay.limit,
      },
      timeoutMs: QUERY_TIMEOUT_MS,
      abort: options.abort,
      signAuth: options.signAuth,
      onReceived: options.onReceived,
      onComplete: (info) => {
        // Effective EOSE also includes deadlines and CLOSED. Only the actual
        // wire marker permits moving past this page's time boundary.
        wireEose = info.relays.length === 1 &&
          info.relays[0].status === 'eose' && info.relays[0].reason == null;
      },
    }).catch((error: unknown) => {
      if (!current() || error instanceof RelayQueryError) return [];
      throw error;
    });
    if (!current()) break;

    let oldest = relay.until;
    let count = 0;
    for (const event of events) {
      if (!current()) break;
      if (event.created_at < options.since || event.created_at > relay.until) continue;
      oldest = Math.min(oldest, event.created_at);
      count++;
      await options.onEvent(event);
    }
    if (!current()) break;
    if (!wireEose) {
      interrupted.push(relay.url);
      continue;
    }
    if (count === 0) continue;
    if (oldest < relay.until) {
      // Re-read the entire boundary second before crossing it, including when
      // it equals `since`. Local processed IDs absorb the overlap.
      relay.until = oldest;
      relay.limit = PAGE_SIZE;
    } else if (count >= relay.limit) {
      if (relay.limit === MAX_BOUNDARY_PAGE_SIZE) {
        // NIP-01 has no secondary event-ID cursor. Never silently skip a
        // saturated second; leave the window unconfirmed for a later retry.
        interrupted.push(relay.url);
        continue;
      }
      relay.limit = Math.min(relay.limit * 2, MAX_BOUNDARY_PAGE_SIZE);
    } else {
      relay.until--;
      relay.limit = PAGE_SIZE;
    }
    if (relay.until >= options.since) pending.push(relay);
  }
  return interrupted;
}
