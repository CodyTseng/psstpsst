import { notifyApplicationChange, subscribeApplicationChanges } from './application-changes';
import { platform } from '@/platform';
import { invalidateReplaceableEvents } from '@/services/relay/replaceable-events.service';
import { assertNotAborted } from '@/platform/abort';
import { parseNostrEventReference } from '@/lib/nostr/event-reference';
import { normalizeRelayUrls } from '@/lib/nostr/relay-url';
import { NappletNetwork } from '@/services/napplet/network';
import { ensureReplaceableFresh, type ReplaceableKey } from '@/services/relay/replaceable-events.service';
import { parseApplicationEvents } from './application-event';
import { APPLICATION_CATALOGUE_SOURCES } from './catalogue-relays';
import { applicationCoordinate, cacheApplicationEvent, parseApplicationEvent, readApplicationCache, withApplicationMetadata } from './application-cache';
import type { ExploreEntry } from './model';
import { applicationEntryFromAddress } from './application-address';
import { readCachedEventRecords, storeCachedEvent } from '@/services/nostr/cached-events.service';

export const APPLICATION_METADATA_TTL_SECONDS = 3600;
const retryAfter = new Map<string, number>();
type MetadataRequest = { life: AbortController; consumers: number; settled: boolean; promise: Promise<ExploreEntry> };
const resolving = new Map<string, MetadataRequest>();
export { subscribeApplicationChanges as subscribeApplicationMetadata } from './application-changes';

async function relaysFor(network: NappletNetwork, entry: ExploreEntry, kind: number | undefined, signal: AbortSignal) {
  const reference = parseNostrEventReference(entry.address);
  if (reference?.relays.length) return reference.relays;
  const writes = reference?.author ? await network.routes([reference.author], 'write', true, signal).catch(() => []) : [];
  assertNotAborted(signal);
  const dedicated = APPLICATION_CATALOGUE_SOURCES.filter(source => kind === undefined || source.kinds.includes(kind)).flatMap(source => source.relays);
  return normalizeRelayUrls([...writes, ...dedicated]);
}

/** A successful complete lookup renews freshness, including unchanged and missing results. */
export async function refreshApplicationMetadata(account: string, entries: ExploreEntry[], signal: AbortSignal): Promise<void> {
  const pending = entries.filter(entry => applicationCoordinate(entry) && (retryAfter.get(entry.key) ?? 0) <= Date.now());
  if (!pending.length) return;
  let network: NappletNetwork | undefined;
  const getNetwork = () => network ??= new NappletNetwork(account);
  const abort = () => network?.destroy(); signal.addEventListener('abort', abort, { once: true });
  const key = (coordinate: ReplaceableKey) => JSON.stringify([coordinate.pubkey, coordinate.kind, coordinate.dTag ?? '']);
  const bySource = new Map(pending.map(entry => [entry.key, entry]));
  const byCoordinate = new Map(pending.map(entry => [key(applicationCoordinate(entry)!), entry]));
  try {
    assertNotAborted(signal);
    await ensureReplaceableFresh(pending.map(entry => applicationCoordinate(entry)!), {
      ttlSeconds: APPLICATION_METADATA_TTL_SECONDS,
      onEventStored: (event, eventRelays) => {
        const app = { ...parseApplicationEvent(event), eventRelays }, previous = bySource.get(app.key);
        if (previous) notifyApplicationChange(withApplicationMetadata(previous, app));
      },
      relays: coordinate => relaysFor(getNetwork(), byCoordinate.get(key(coordinate))!, coordinate.kind, signal),
      query: async (relays, filters) => {
        const response = await getNetwork().query(relays, filters, signal);
        assertNotAborted(signal);
        if (response.incomplete || response.error) throw new Error('application-refresh-incomplete');
        const apps = await parseApplicationEvents(response.events);
        const valid = apps.flatMap(app => app?.manifest ? [app.manifest] : []);
        if (response.events.length && !valid.length) throw new Error('applications.invalid_manifest');
        return { events: valid, eventRelays: response.eventRelays };
      },
    });
    for (const entry of pending) retryAfter.delete(entry.key);
  } catch (error) {
    if (!signal.aborted) {
      for (const entry of pending) retryAfter.set(entry.key, Date.now() + 60_000);
      while (retryAfter.size > 1024) retryAfter.delete(retryAfter.keys().next().value!);
    }
    throw error;
  } finally { signal.removeEventListener('abort', abort); network?.destroy(); }
}

/** Cache hits return immediately; a stale coordinate refreshes without delaying navigation. */
export async function resolveApplicationMetadata(account: string, input: ExploreEntry | string, signal: AbortSignal,
  options: { refresh?: boolean; known?: readonly ExploreEntry[] } = {}): Promise<ExploreEntry> {
  assertNotAborted(signal);
  const entry = typeof input === 'string' ? applicationEntryFromAddress(input) : input;
  if (!entry) throw new Error('applications.invalid_manifest');
  const reference = parseNostrEventReference(entry.address);
  let known: ExploreEntry | undefined;
  for (const candidate of options.known ?? []) {
    if (reference?.id ? candidate.manifest?.id !== reference.id : candidate.key !== entry.key) continue;
    if (!reference?.id && reference?.kind !== undefined && candidate.manifest && candidate.manifest.kind !== reference.kind) continue;
    if (!known || (candidate.manifest?.created_at ?? 0) > (known.manifest?.created_at ?? 0) ||
      candidate.manifest?.created_at === known.manifest?.created_at && (candidate.manifest?.id ?? '') < (known.manifest?.id ?? '')) known = candidate;
  }
  if (known?.manifest) {
    await cacheApplicationEvent(known);
    if (reference?.id) await storeCachedEvent(known.manifest, known.eventRelays);
  }
  if (entry.key.startsWith('local~')) {
    const { readLocalApplication } = await import('./local-applications');
    const local = await readLocalApplication(account, entry.key); assertNotAborted(signal);
    if (!local) throw new Error('applications.not_found');
    return withApplicationMetadata(entry, local);
  }
  if (entry.kind === 'website') return known ?? entry;
  assertNotAborted(signal);
  if (entry.manifest) await cacheApplicationEvent(entry);
  const cached = options.refresh ? undefined : reference?.id
    ? await readApplicationId(reference.id)
    : (await readApplicationCache([entry])).get(entry.key);
  assertNotAborted(signal);
  if (cached) {
    if (!reference?.id) void refreshApplicationMetadata(account, [entry], signal).catch(() => {});
    return withApplicationMetadata(entry, cached);
  }
  const key = JSON.stringify([account, reference?.id ?? entry.key]);
  let request = resolving.get(key);
  if (!request || request.life.signal.aborted) {
    const shared: MetadataRequest = { life: new AbortController(), consumers: 0, settled: false, promise: undefined! };
    shared.promise = fetchApplicationMetadata(account, entry, shared.life.signal).finally(() => {
      shared.settled = true;
      if (resolving.get(key) === shared) resolving.delete(key);
    });
    resolving.set(key, shared); request = shared;
  }
  const shared = request;
  shared.consumers++;
  return new Promise<ExploreEntry>((resolve, reject) => {
    let finished = false;
    const release = () => {
      if (finished) return false;
      finished = true; signal.removeEventListener('abort', abort);
      if (--shared.consumers === 0 && !shared.settled) {
        if (resolving.get(key) === shared) resolving.delete(key);
        shared.life.abort();
      }
      return true;
    };
    const abort = () => {
      if (!release()) return;
      try { assertNotAborted(signal); } catch (error) { reject(error); }
    };
    signal.addEventListener('abort', abort, { once: true });
    shared.promise.then(result => {
      if (release()) resolve(withApplicationMetadata(entry, result));
    }, error => { if (release()) reject(error); });
    if (signal.aborted) abort();
  });
}

async function readApplicationId(id: string): Promise<ExploreEntry | undefined> {
  const cached = (await readCachedEventRecords([id])).get(id);
  if (!cached) return;
  const [app] = await parseApplicationEvents([cached.event]);
  return app ? { ...app, eventRelays: cached.relays, release: app.release ? { ...app.release, eventRelays: cached.relays } : undefined } : undefined;
}

async function fetchApplicationMetadata(account: string, entry: ExploreEntry, signal: AbortSignal): Promise<ExploreEntry> {
  const reference = parseNostrEventReference(entry.address);
  if (!reference) throw new Error('applications.invalid_manifest');
  const coordinate = applicationCoordinate(entry);
  const network = new NappletNetwork(account);
  const abort = () => network.destroy(); signal.addEventListener('abort', abort, { once: true });
  try {
    const kind = coordinate?.kind;
    const relays = await relaysFor(network, entry, kind, signal);
    const response = await network.query(relays, [coordinate ? { authors: [coordinate.pubkey], kinds: [coordinate.kind],
      ...(coordinate.kind >= 30000 ? { '#d': [coordinate.dTag ?? ''] } : {}), limit: 1 } : { ids: [reference.id!], limit: 1 }], signal);
    assertNotAborted(signal);
    const events = response.events.sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id));
    for (const [index, event] of events.entries()) {
      if (index % 4 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      assertNotAborted(signal);
      let app: ExploreEntry;
      try { app = parseApplicationEvent(event); } catch { continue; }
      if (reference.id ? event.id !== reference.id : app.key !== entry.key) continue;
      app = { ...app, eventRelays: response.eventRelays?.get(event.id) ?? [] };
      if (!app.servers.length) {
        app.servers = await network.mediaServers(event.pubkey, signal).catch(() => []);
        if (app.release) app.release = { ...app.release, servers: app.servers };
      }
      assertNotAborted(signal);
      await cacheApplicationEvent(app);
      if (reference.id) await storeCachedEvent(event, app.eventRelays);
      return withApplicationMetadata(entry, app);
    }
    throw new Error(events.length ? 'applications.invalid_manifest' : response.incomplete || response.error ? 'applications.request_failed' : 'applications.not_found');
  } finally { signal.removeEventListener('abort', abort); network.destroy(); }
}


/** Database notifications cover sibling Electron hosts; version comparisons suppress timestamp-only updates. */
export function watchApplicationMetadata(account: string, entry: ExploreEntry, onLatest: (entry: ExploreEntry) => void) {
  const life = new AbortController();
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const read = async () => {
    const cached = (await readApplicationCache([entry])).get(entry.key);
    if (!life.signal.aborted && cached) onLatest(withApplicationMetadata(entry, cached));
  };
  const stopEvents = subscribeApplicationChanges(updated => { if (updated.key === entry.key && !life.signal.aborted) onLatest(withApplicationMetadata(entry, updated)); });
  const stopDatabase = platform.database?.addChangeListener?.(event => {
    if (event.tableName && !['replaceable_events', 'cached_events'].includes(event.tableName)) return;
    if (event.external) invalidateReplaceableEvents();
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => { void read().catch(() => {}); }, 40);
  });
  return {
    refresh() {
      void read().catch(() => {});
      void refreshApplicationMetadata(account, [entry], life.signal).catch(() => {});
    },
    stop() { life.abort(); if (debounce) clearTimeout(debounce); stopEvents(); stopDatabase?.(); },
  };
}
