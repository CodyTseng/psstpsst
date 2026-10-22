import { sql } from 'drizzle-orm';
import { replaceableEvents } from '@/db/schema';
import { favoriteCoordinates, pruneEventCache } from '@/services/nostr/event-cache-retention';
import { notifyApplicationChange } from './application-changes';
import type { Event } from 'nostr-tools';
import { parseNostrEventReference } from '@/lib/nostr/event-reference';
import { getReplaceableEventRecords, getReplaceableEvent, storeReplaceableEvent, type ReplaceableKey } from '@/services/relay/replaceable-events.service';
import { readCachedEvents, readCachedEventRecords, storeCachedEvent } from '@/services/nostr/cached-events.service';
import { isNewerEvent } from '@/lib/nostr/event-version';
import type { ExploreEntry } from './model';
import { parseApplicationEvent, parseApplicationEvents, withApplicationMetadata } from './application-event';
import { createPerfSpan, profileAsync } from '@/lib/perf/profiler';
export { parseApplicationEvent, withApplicationMetadata } from './application-event';

export function applicationCoordinate(entry: Pick<ExploreEntry, 'address' | 'kind'>): ReplaceableKey | undefined {
  if (entry.kind === 'website') return;
  const reference = parseNostrEventReference(entry.address);
  if (reference?.author && reference.kind && reference.identifier !== undefined)
    return { pubkey: reference.author, kind: reference.kind, dTag: reference.kind >= 30000 ? reference.identifier : '' };
}

/** A sibling-host notification reads only the specified application's current row. */
export async function readChangedApplicationMetadata(entry: ExploreEntry): Promise<ExploreEntry | undefined> {
  return (await readApplicationCache([entry])).get(entry.key);
}

export async function cacheApplicationEvent(entry: ExploreEntry, options: { retain?: boolean } = {}): Promise<void> {
  if (!entry.manifest) return;
  const verified = parseApplicationEvent(entry.manifest);
  if (verified.key !== entry.key) throw new Error('invalid-application-coordinate');
  let changed = false;
  if (entry.manifest.kind === 5129) {
    const exists = (await readCachedEvents([entry.manifest.id])).has(entry.manifest.id);
    if (!exists || entry.eventRelays?.length) { await storeCachedEvent(entry.manifest, entry.eventRelays); changed = !exists; }
  } else {
    const coordinate = applicationCoordinate(entry);
    if (!coordinate) throw new Error('invalid-application-coordinate');
    const current = await getReplaceableEvent(coordinate);
    if (!current || isNewerEvent(entry.manifest, current) || options.retain || entry.eventRelays?.length) {
      const newer = !current || isNewerEvent(entry.manifest, current);
      const manifest = !newer && current ? parseApplicationEvent(current).manifest! : entry.manifest;
      changed = await storeReplaceableEvent(manifest, { confirmed: newer && (!options.retain || !!current),
        relays: manifest.id === entry.manifest.id ? entry.eventRelays : undefined });
      await pruneEventCache(replaceableEvents, sql`json_array(${replaceableEvents.pubkey},${replaceableEvents.kind},${replaceableEvents.dTag})`,
        replaceableEvents.event, replaceableEvents.fetchedAt, sql`${replaceableEvents.kind} IN (15128,15129,35128,35129,35130)
          AND (${replaceableEvents.kind} || ':' || ${replaceableEvents.pubkey} || ':' || ${replaceableEvents.dTag}) NOT IN (${favoriteCoordinates})`);
    }
  }
  if (changed) notifyApplicationChange(withApplicationMetadata(entry, { ...verified, eventRelays: entry.eventRelays }));
}

/** One batched read per cache type; absent manifests remain ordinary saved references. */
export async function readApplicationCache(entries: Pick<ExploreEntry, 'key' | 'address' | 'kind'>[]): Promise<Map<string, ExploreEntry>> {
  const span = createPerfSpan('explore.metadata', { count: entries.length });
  try {
    const coordinates: { key: string; coordinate: ReplaceableKey }[] = [];
    const ids: { key: string; id: string }[] = [];
    for (const entry of entries) {
      const coordinate = applicationCoordinate(entry);
      if (coordinate) coordinates.push({ key: entry.key, coordinate });
      else if (entry.kind !== 'website') {
        const reference = parseNostrEventReference(entry.address);
        if (reference?.id) ids.push({ key: entry.key, id: reference.id });
      }
    }
    const [replaceable, immutable] = await profileAsync(span, 'database', () => Promise.all([
      getReplaceableEventRecords(coordinates.map(item => item.coordinate), { fresh: true }), readCachedEventRecords(ids.map(item => item.id)),
    ]));
    const events = [...coordinates.map((item, index) => ({ key: item.key, event: replaceable[index].event, relays: replaceable[index].relays })),
      ...ids.map(item => ({ key: item.key, event: immutable.get(item.id)?.event, relays: immutable.get(item.id)?.relays }))]
      .filter((item): item is { key: string; event: Event; relays: string[] | undefined } => !!item.event);
    const apps = await profileAsync(span, 'verify-and-parse', () => parseApplicationEvents(events.map(item => item.event)));
    const result = new Map<string, ExploreEntry>();
    apps.forEach((app, index) => { if (app?.key === events[index].key) {
      const eventRelays = events[index].relays ?? [];
      result.set(app.key, { ...app, eventRelays, release: app.release ? { ...app.release, eventRelays } : undefined });
    } });
    return result;
  } finally { span?.end(); }
}
