import { inArray, sql } from 'drizzle-orm';
import type { Event } from 'nostr-tools';

import { db } from '@/db/client';
import { referencedEvents } from '@/db/schema';
import type { NostrEventReference } from '@/lib/nostr/event-reference';
import { DISCOVERY_RELAYS, normalizeRelayUrl } from '@/lib/nostr/relay-url';

import { cacheProfileEvent } from '../profile/profile.service';
import { relayPool } from '../relay/relay-pool';
import { peerMetaRelays } from '../relay/relay-router';

const MISS_TTL_MS = 30 * 1000;
const MAX_MEMORY_CACHE_ENTRIES = 256;
const MAX_PERSISTED_EVENTS = 2_048;
const QUERY_TIMEOUT_MS = 5_000;
const MAX_HINT_RELAYS = 5;

type CacheEntry = { event: Event | null; fetchedAt: number };
type PersistedReadWaiter = {
  id: string;
  resolve: (event: Event | null) => void;
};
type IdWaiter = PersistedReadWaiter & { reject: (error: unknown) => void };
type PendingIdBatch = { relays: string[]; waiters: IdWaiter[] };

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<Event | null>>();
const pendingIdBatches = new Map<string, PendingIdBatch>();
const pendingPersistedReads: PersistedReadWaiter[] = [];
let relayFlushScheduled = false;
let persistedReadScheduled = false;

/** naddr is intentionally unsupported, as are nevent pointers that explicitly
 * identify a kind other than the two locally rendered kinds. A bare note or an
 * untyped nevent still needs one lookup to discover its kind. */
export function canResolveReferencedEvent(reference: NostrEventReference): boolean {
  return (
    reference.id != null &&
    (reference.kind == null || reference.kind === 0 || reference.kind === 1)
  );
}

function readFreshMemoryCache(key: string): Event | null | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (!entry.event && Date.now() - entry.fetchedAt >= MISS_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  // Successful events are immutable by id. Refresh insertion order so pruning
  // behaves as a small LRU; only negative entries expire.
  cache.delete(key);
  cache.set(key, entry);
  return entry.event;
}

function writeMemoryCache(key: string, event: Event | null) {
  cache.delete(key);
  cache.set(key, { event, fetchedAt: Date.now() });
  while (cache.size > MAX_MEMORY_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function safeRelayHints(hints: string[]): string[] {
  const normalized = new Set<string>();
  for (const hint of hints) {
    try {
      normalized.add(normalizeRelayUrl(hint));
      if (normalized.size >= MAX_HINT_RELAYS) break;
    } catch {
      // NIP-19 relay hints are untrusted input; ignore malformed/non-WS URLs.
    }
  }
  return [...normalized];
}

function primaryRelays(reference: NostrEventReference): string[] {
  const hints = safeRelayHints(reference.relays);
  return Array.from(new Set([...hints, ...DISCOVERY_RELAYS]));
}

/** Coalesce same-relay-set id lookups mounted in one render into a single REQ. */
function fetchIdBatched(relays: string[], id: string): Promise<Event | null> {
  const relayKey = [...relays].sort().join('\n');
  return new Promise((resolve, reject) => {
    const batch = pendingIdBatches.get(relayKey) ?? { relays, waiters: [] };
    batch.waiters.push({ id, resolve, reject });
    pendingIdBatches.set(relayKey, batch);
    if (relayFlushScheduled) return;
    relayFlushScheduled = true;
    queueMicrotask(flushIdBatches);
  });
}

function flushIdBatches() {
  relayFlushScheduled = false;
  const batches = [...pendingIdBatches.values()];
  pendingIdBatches.clear();
  for (const batch of batches) {
    const ids = Array.from(new Set(batch.waiters.map((waiter) => waiter.id)));
    void relayPool
      .query({
        label: 'event-reference-ids',
        relays: batch.relays,
        filter: { ids, limit: ids.length },
        timeoutMs: QUERY_TIMEOUT_MS,
      })
      .then((events) => {
        const byId = new Map(events.map((event) => [event.id, event]));
        for (const waiter of batch.waiters) waiter.resolve(byId.get(waiter.id) ?? null);
      })
      .catch((error: unknown) => {
        for (const waiter of batch.waiters) waiter.reject(error);
      });
  }
}

/** Batch cold-session SQLite reads and defer them one macrotask so loading
 * cards can paint before the async database request is scheduled. */
function readPersistedEventBatched(id: string): Promise<Event | null> {
  return new Promise((resolve) => {
    pendingPersistedReads.push({ id, resolve });
    if (persistedReadScheduled) return;
    persistedReadScheduled = true;
    setTimeout(() => void flushPersistedReads(), 0);
  });
}

async function flushPersistedReads() {
  persistedReadScheduled = false;
  const waiters = pendingPersistedReads.splice(0);
  const ids = Array.from(new Set(waiters.map((waiter) => waiter.id)));
  try {
    const rows = await db
      .select({ id: referencedEvents.id, event: referencedEvents.event })
      .from(referencedEvents)
      .where(inArray(referencedEvents.id, ids));
    const byId = new Map(
      rows
        .filter((row) => row.event.id === row.id)
        .map((row) => [row.id, row.event] as const),
    );
    for (const waiter of waiters) waiter.resolve(byId.get(waiter.id) ?? null);
  } catch {
    // A cache read must never prevent the normal relay fallback.
    for (const waiter of waiters) waiter.resolve(null);
  }
}

async function persistReferencedEvent(event: Event): Promise<void> {
  const fetchedAt = Math.floor(Date.now() / 1000);
  await db
    .insert(referencedEvents)
    .values({ id: event.id, event, fetchedAt })
    .onConflictDoUpdate({
      target: referencedEvents.id,
      set: { event, fetchedAt },
    });
  // Bound raw event storage. The fetched-at index makes this pruning query
  // proportional to the small tail being removed, not conversation history.
  await db.run(sql`
    DELETE FROM ${referencedEvents}
    WHERE ${referencedEvents.id} IN (
      SELECT ${referencedEvents.id}
      FROM ${referencedEvents}
      ORDER BY ${referencedEvents.fetchedAt} DESC
      LIMIT -1 OFFSET ${MAX_PERSISTED_EVENTS}
    )
  `);
}

/** Fetch a supported note/nevent pointer. Successful immutable events persist
 * in SQLite; memory also keeps a bounded LRU and short-lived negative entries. */
export async function fetchReferencedEvent(
  reference: NostrEventReference,
): Promise<Event | null> {
  if (!canResolveReferencedEvent(reference) || !reference.id) return null;
  const key = reference.id;
  const cached = readFreshMemoryCache(key);
  if (cached !== undefined) return cached;
  const current = inflight.get(key);
  if (current) return current;

  const request = (async () => {
    try {
      const persisted = await readPersistedEventBatched(key);
      if (persisted) {
        if (persisted.kind === 0) await cacheProfileEvent(persisted);
        writeMemoryCache(key, persisted);
        return persisted;
      }

      const relays = primaryRelays(reference);
      let event = await fetchIdBatched(relays, key);

      // Embedded hints + discovery cover the common path without first waiting
      // on an outbox lookup. Only a miss pays for the author's NIP-65 relays.
      if (!event && reference.author) {
        const authorRelays = await peerMetaRelays(reference.author);
        const tried = new Set(relays);
        const fallbackRelays = authorRelays.filter((relay) => !tried.has(relay));
        if (fallbackRelays.length > 0) event = await fetchIdBatched(fallbackRelays, key);
      }

      if (event) {
        await persistReferencedEvent(event);
        if (event.kind === 0) await cacheProfileEvent(event);
      }
      writeMemoryCache(key, event);
      return event;
    } catch {
      // Network failures remain retryable; only completed misses are cached.
      return null;
    }
  })().finally(() => inflight.delete(key));

  inflight.set(key, request);
  return request;
}

export function getCachedReferencedEvent(
  reference: NostrEventReference,
): Event | null | undefined {
  if (!canResolveReferencedEvent(reference) || !reference.id) return null;
  return readFreshMemoryCache(reference.id);
}
