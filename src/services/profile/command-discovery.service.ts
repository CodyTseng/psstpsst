import { verifyEvent, type Event } from 'nostr-tools';

import { COMMAND_KIND } from '@/lib/nostr/commands';
import { isNewerEvent } from '@/lib/nostr/event-version';
import { DISCOVERY_RELAYS, normalizeRelayUrl } from '@/lib/nostr/relay-url';
import { queryMetadataRelay } from '../relay/metadata-query';
import { pickPeerRelays, resolvePeerOutbox } from '../relay/relay-router';
import { REPLACEABLE_DEFAULT_TTL_SECONDS, reconcileReplaceableEventCollection, storeReplaceableEvent } from '../relay/replaceable-events.service';

export const COMMAND_TTL_SECONDS = REPLACEABLE_DEFAULT_TTL_SECONDS;
const MAX_DISCOVERY_AUTHORS = 4096;
const checkedAt = new Map<string, number>();
const inflight = new Map<string, Promise<void>>();

/** Discover a peer's kind-14 command declarations and persist them in the shared cache.
 * Collection freshness is session-scoped because unseen d values have no cache key. */
export async function fetchCommandDeclarations(pubkeys: string[], extraRelays: string[] = []): Promise<void> {
  const authors = [...new Set(pubkeys)].filter(pubkey => /^[a-f0-9]{64}$/.test(pubkey));
  const results = await Promise.allSettled(authors.map(pubkey => {
    const active = inflight.get(pubkey);
    if (active) return active;
    const lastChecked = checkedAt.get(pubkey);
    if (lastChecked !== undefined && Math.floor(Date.now() / 1000) - lastChecked < COMMAND_TTL_SECONDS) return;
    const task = refresh(pubkey, extraRelays).finally(() => inflight.delete(pubkey));
    inflight.set(pubkey, task);
    return task;
  }));
  const failure = results.find(result => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
}

async function refresh(pubkey: string, extraRelays: string[]): Promise<void> {
  const { write } = await resolvePeerOutbox(pubkey);
  const outbox = [...new Set(pickPeerRelays(write).map(normalizeRelayUrl))];
  const relays = [...new Set([...outbox, ...extraRelays, ...DISCOVERY_RELAYS].map(normalizeRelayUrl))];
  const results = await Promise.allSettled(relays.map(relay => queryMetadataRelay(relay, [
    { kinds: [COMMAND_KIND], authors: [pubkey], '#s': ['kind:14'] },
  ])));
  const completed = results.flatMap((result, index) => result.status === 'fulfilled' ? [relays[index]] : []);
  if (!completed.length) throw new Error('Command discovery did not complete on any relay');
  const now = Math.floor(Date.now() / 1000);
  const seen = new Set<string>();
  const latest = new Map<string, Event>();
  let processed = 0;
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const event of result.value) {
      // Signature work must not monopolize the renderer for a large declaration set.
      if (++processed % 32 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      if (seen.has(event.id)) continue;
      try {
        if (event.kind !== COMMAND_KIND || event.pubkey !== pubkey || !Number.isSafeInteger(event.created_at) ||
          event.created_at < 0 || event.created_at > now + 600 || !verifyEvent(event)) continue;
        seen.add(event.id);
        const dTag = event.tags.find(tag => tag[0] === 'd')?.[1] ?? '';
        const previous = latest.get(dTag);
        if (!previous || isNewerEvent(event, previous)) latest.set(dTag, event);
      } catch { /* Malformed and forged events never enter the cache. */ }
    }
  }
  // A failed write source can still hold commands absent from responding replicas.
  // Keep partial discoveries, but only a completed source set may remove old rows.
  const sources = outbox.length ? outbox : relays;
  if (!sources.every(relay => completed.includes(relay))) {
    for (const event of latest.values()) await storeReplaceableEvent(event);
    throw new Error('Command discovery did not complete on every source relay');
  }
  await reconcileReplaceableEventCollection(pubkey, COMMAND_KIND, [...latest.values()]);
  checkedAt.delete(pubkey);
  if (checkedAt.size >= MAX_DISCOVERY_AUTHORS) checkedAt.delete(checkedAt.keys().next().value!);
  checkedAt.set(pubkey, now);
}
