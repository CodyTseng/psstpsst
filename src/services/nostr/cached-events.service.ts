import { inArray, sql } from 'drizzle-orm';
import type { Event } from 'nostr-tools';
import { db } from '@/db/client';
import { cachedEvents } from '@/db/schema';

import { favoriteEventIds, pruneEventCache } from './event-cache-retention';
import { boundedEventRelays, mergeEventRelaySources } from './event-relay-sources';

/** Shared immutable-ID cache. Callers verify event signatures and their domain format. */
export async function readCachedEvents(ids: string[]): Promise<Map<string, Event>> {
  return new Map([...(await readCachedEventRecords(ids))].map(([id, row]) => [id, row.event]));
}

/** Keep event data and its provenance together in the same bounded database reads. */
export async function readCachedEventRecords(ids: string[]): Promise<Map<string, { event: Event; relays: string[] }>> {
  const result = new Map<string, { event: Event; relays: string[] }>();
  const unique = [...new Set(ids)];
  for (let offset = 0; offset < unique.length; offset += 128) {
    const rows = await db.select({ id: cachedEvents.id, event: cachedEvents.event, relays: cachedEvents.relays }).from(cachedEvents)
      .where(inArray(cachedEvents.id, unique.slice(offset, offset + 128)));
    for (const row of rows) if (row.id === row.event.id) result.set(row.id, { event: row.event, relays: row.relays ?? [] });
  }
  return result;
}

export async function storeCachedEvent(event: Event, sources: string[] = []): Promise<void> {
  const fetchedAt = Math.floor(Date.now() / 1000);
  const relays = boundedEventRelays(sources);
  await db.insert(cachedEvents).values({ id: event.id, event, fetchedAt, relays })
    .onConflictDoUpdate({ target: cachedEvents.id, set: { event, fetchedAt,
      ...(relays.length ? { relays: mergeEventRelaySources(cachedEvents.relays, relays) } : {}),
    } });
  await pruneEventCache(cachedEvents, cachedEvents.id, cachedEvents.event, cachedEvents.fetchedAt,
    sql`${cachedEvents.id} NOT IN (${favoriteEventIds})`);
}
