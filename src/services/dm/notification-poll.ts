import type { Event, EventTemplate } from 'nostr-tools';

import { readGiftWrapPage } from './gift-wrap-pager';

type PollOptions = {
  label?: string;
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
    url, until: options.until,
  }));
  const interrupted: string[] = [];
  const current = () => !options.abort.aborted && options.isCurrent();
  while (pending.length > 0 && current()) {
    // Rotate between relays so a large inbox cannot starve other replicas.
    const relay = pending.shift()!;
    const result = await readGiftWrapPage({
      label: options.label ?? 'dm.notification-poll',
      accountPubkey: options.accountPubkey,
      relayUrl: relay.url,
      since: options.since,
      until: relay.until,
      abort: options.abort,
      isCurrent: options.isCurrent,
      signAuth: options.signAuth,
      onReceived: options.onReceived,
      onPage: async (page) => {
        for (const event of page) {
          if (!current()) break;
          await options.onEvent(event);
        }
      },
    });
    if (result.status === 'aborted') break;
    if (result.status === 'interrupted') {
      interrupted.push(relay.url);
      continue;
    }
    if (result.status === 'page' && result.nextUntil >= options.since) {
      relay.until = result.nextUntil;
      pending.push(relay);
    }
  }
  return interrupted;
}
