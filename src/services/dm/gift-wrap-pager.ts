import type { Event, EventTemplate } from 'nostr-tools';

import { relayPool } from '../relay/relay-pool';
import { RelayQueryError } from '../relay/relay-query-error';
import { DEFAULT_EOSE_TIMEOUT_MS, isEffectiveEose } from '../relay/relay-read';

const PAGE_SIZE = 500;

type GiftWrapPageOptions = {
  label: string;
  accountPubkey: string;
  relayUrl: string;
  since: number;
  until: number;
  abort?: AbortSignal;
  isCurrent(): boolean;
  signAuth?: (event: EventTemplate) => Promise<Event>;
  onReceived(relayUrl: string, id: string): void;
  onPage(events: Event[]): Promise<void>;
};

type GiftWrapPageResult =
  | { status: 'page'; nextUntil: number }
  | { status: 'drained' | 'interrupted' | 'aborted' };

/** Shared bounded pager for history, reconnect recovery, and notification polls.
 * Process each page before advancing; callers own scheduling and checkpoints.
 * Boundary seconds are rechecked at the same fixed limit before crossing them.
 */
export async function readGiftWrapPage(options: GiftWrapPageOptions): Promise<GiftWrapPageResult> {
  const current = () => !options.abort?.aborted && options.isCurrent();
  if (!current()) return { status: 'aborted' };
  if (options.until < options.since) return { status: 'drained' };
  let completed = false;
  const events = await relayPool.query({
    label: options.label,
    relays: [options.relayUrl],
    filter: {
      kinds: [1059], '#p': [options.accountPubkey],
      since: options.since, until: options.until, limit: PAGE_SIZE,
    },
    timeoutMs: DEFAULT_EOSE_TIMEOUT_MS,
    abort: options.abort,
    signAuth: options.signAuth,
    onReceived: options.onReceived,
    onComplete: (info) => {
      completed = info.relays.length === 1 && isEffectiveEose(info.relays[0]);
    },
  }).catch((error: unknown) => {
    if (!current() || error instanceof RelayQueryError) return [];
    throw error;
  });
  if (!current()) return { status: 'aborted' };
  const page = Array.from(new Map(events
    .filter(event => event.created_at >= options.since && event.created_at <= options.until)
    .map(event => [event.id, event])).values()).sort((a, b) => b.created_at - a.created_at);
  await options.onPage(page);
  if (!current()) return { status: 'aborted' };
  if (!completed) return { status: 'interrupted' };
  if (page.length === 0) return { status: 'drained' };
  const oldest = page[page.length - 1].created_at;
  return { status: 'page', nextUntil: oldest < options.until ? oldest : options.until - 1 };
}
