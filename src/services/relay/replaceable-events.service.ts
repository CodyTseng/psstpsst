import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { Filter } from 'nostr-tools';

import { db } from '@/db/client';
import { replaceableEvents, type NostrEvent } from '@/db/schema';

import { relayPool } from './relay-pool';
import { RelayQueryError } from './relay-query-error';

/** Default freshness window for cached replaceable events; callers may override per kind. */
export const REPLACEABLE_DEFAULT_TTL_SECONDS = 24 * 3600;

/** Emoji pack sets (kind 30030) are a shared cache of *other people's* packs, so
 * the table is bounded: least-recently-confirmed packs beyond the cap are
 * evicted. Mirror entries for evicted rows may linger in memory until their own
 * eviction — harmless, the event data stays valid. */
export const MAX_PERSISTED_EMOJI_PACKS = 2_048;
const KIND_EMOJI_SET = 30030;

/** Identifies one replaceable/addressable event slot. `dTag` defaults to '' (plain replaceable). */
export type ReplaceableKey = {
  pubkey: string;
  kind: number;
  dTag?: string;
};

export type EnsureReplaceableFreshOpts = {
  ttlSeconds: number;
  /** Shared relay set, or a per-key resolver (peer outbox ∪ discovery, etc.). */
  relays: string[] | ((key: ReplaceableKey) => Promise<string[]>);
  /** Called once after a refresh persisted anything (stored events or miss marks). */
  onUpdated?: () => void;
};

type CachedRow = {
  event: NostrEvent | null;
  createdAt: number | null;
  fetchedAt: number;
};

// Small in-memory mirror so hot paths (e.g. re-resolving the same keys while a
// conversation is open) don't re-read the database. Every write path in this
// module keeps it in sync, so it can also serve as the freshest-known row.
const MIRROR_LIMIT = 4096;
const mirror = new Map<string, CachedRow>();

// Concurrent refreshes of the same key share one in-flight query.
const inflight = new Map<string, Promise<void>>();

function normalizeKey(key: ReplaceableKey): Required<ReplaceableKey> {
  return { pubkey: key.pubkey, kind: key.kind, dTag: key.dTag ?? '' };
}

function cacheKeyOf(key: ReplaceableKey): string {
  return JSON.stringify([key.pubkey, key.kind, key.dTag ?? '']);
}

/** Invalidate after a transaction writes the durable cache alongside outbox work. */
export function invalidateReplaceableEvent(key: ReplaceableKey): void {
  mirror.delete(cacheKeyOf(key));
}

/** NIP-33 addressable kinds take their `d` tag; plain replaceable kinds use ''. */
function dTagOfEvent(event: NostrEvent): string {
  if (event.kind >= 30000 && event.kind < 40000) {
    return event.tags.find((tag) => tag[0] === 'd')?.[1] ?? '';
  }
  return '';
}

function cacheKeyOfEvent(event: NostrEvent): string {
  return JSON.stringify([event.pubkey, event.kind, dTagOfEvent(event)]);
}

function setMirror(cacheKey: string, row: CachedRow): void {
  if (!mirror.has(cacheKey) && mirror.size >= MIRROR_LIMIT) {
    const oldest = mirror.keys().next().value;
    if (oldest !== undefined) mirror.delete(oldest);
  }
  mirror.set(cacheKey, row);
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** Reads rows for the given keys, serving/refreshing the mirror. One batched query. */
async function loadRows(keys: ReplaceableKey[]): Promise<Map<string, CachedRow>> {
  const result = new Map<string, CachedRow>();
  const missing: Required<ReplaceableKey>[] = [];
  for (const key of keys) {
    const normalized = normalizeKey(key);
    const cacheKey = cacheKeyOf(normalized);
    const cached = mirror.get(cacheKey);
    if (cached) {
      result.set(cacheKey, cached);
    } else if (!missing.some((m) => cacheKeyOf(m) === cacheKey)) {
      missing.push(normalized);
    }
  }
  if (missing.length > 0) {
    const rows = await db
      .select({
        pubkey: replaceableEvents.pubkey,
        kind: replaceableEvents.kind,
        dTag: replaceableEvents.dTag,
        event: replaceableEvents.event,
        createdAt: replaceableEvents.createdAt,
        fetchedAt: replaceableEvents.fetchedAt,
      })
      .from(replaceableEvents)
      .where(
        or(
          ...missing.map((key) =>
            and(
              eq(replaceableEvents.pubkey, key.pubkey),
              eq(replaceableEvents.kind, key.kind),
              eq(replaceableEvents.dTag, key.dTag),
            ),
          ),
        ),
      );
    for (const row of rows) {
      const cacheKey = cacheKeyOf(row);
      const cached: CachedRow = {
        event: row.event,
        createdAt: row.createdAt,
        fetchedAt: row.fetchedAt,
      };
      setMirror(cacheKey, cached);
      result.set(cacheKey, cached);
    }
  }
  return result;
}

/** Latest stored event for one key, or null (never stored, or a cached miss). Reads only. */
export async function getReplaceableEvent(key: ReplaceableKey): Promise<NostrEvent | null> {
  return (await loadRows([key])).get(cacheKeyOf(key))?.event ?? null;
}

/** Latest stored events aligned with `keys` (null where absent). Reads only, one batched query. */
export async function getReplaceableEvents(
  keys: ReplaceableKey[],
): Promise<(NostrEvent | null)[]> {
  const rows = await loadRows(keys);
  return keys.map((key) => rows.get(cacheKeyOf(key))?.event ?? null);
}

/**
 * Upserts a replaceable event, newest-wins by `created_at`. `fetched_at` always
 * moves to now — both for genuinely newer events and for older duplicates seen
 * on a relay, which still count as a fresh confirmation. Returns true when the
 * stored event actually changed.
 */
export async function storeReplaceableEvent(event: NostrEvent): Promise<boolean> {
  const key = { pubkey: event.pubkey, kind: event.kind, dTag: dTagOfEvent(event) };
  const cacheKey = cacheKeyOfEvent(event);
  const existing = (await loadRows([key])).get(cacheKey);
  const fetchedAt = nowSeconds();

  if (existing && existing.createdAt != null && existing.createdAt >= event.created_at) {
    await db
      .insert(replaceableEvents)
      .values({ ...key, event: existing.event, createdAt: existing.createdAt, fetchedAt })
      .onConflictDoUpdate({
        target: [replaceableEvents.pubkey, replaceableEvents.kind, replaceableEvents.dTag],
        set: { fetchedAt },
      });
    setMirror(cacheKey, { ...existing, fetchedAt });
    return false;
  }

  await db
    .insert(replaceableEvents)
    .values({ ...key, event, createdAt: event.created_at, fetchedAt })
    .onConflictDoUpdate({
      target: [replaceableEvents.pubkey, replaceableEvents.kind, replaceableEvents.dTag],
      set: { event, createdAt: event.created_at, fetchedAt },
      // Guards the read-then-write window against an interleaved newer event.
      setWhere: or(
        isNull(replaceableEvents.createdAt),
        lt(replaceableEvents.createdAt, event.created_at),
      ),
    });
  setMirror(cacheKey, { event, createdAt: event.created_at, fetchedAt });
  if (event.kind === KIND_EMOJI_SET) await pruneEmojiPackCache();
  return true;
}

/** Evicts kind-30030 rows beyond {@link MAX_PERSISTED_EMOJI_PACKS}, keeping the
 * most recently confirmed (fetchedAt) ones. Runs on every emoji-set store; the
 * scan is a few thousand rows at most. */
async function pruneEmojiPackCache(): Promise<void> {
  await db.run(sql`
    DELETE FROM ${replaceableEvents}
    WHERE ${replaceableEvents.kind} = ${KIND_EMOJI_SET}
      AND (${replaceableEvents.pubkey}, ${replaceableEvents.dTag}) IN (
        SELECT ${replaceableEvents.pubkey}, ${replaceableEvents.dTag}
        FROM ${replaceableEvents}
        WHERE ${replaceableEvents.kind} = ${KIND_EMOJI_SET}
        ORDER BY ${replaceableEvents.fetchedAt} DESC
        LIMIT -1 OFFSET ${MAX_PERSISTED_EMOJI_PACKS}
      )
  `);
}

/** Records a confirmed miss (or re-confirmation) without touching the stored event. */
export async function markReplaceableFetched(key: ReplaceableKey): Promise<void> {
  const normalized = normalizeKey(key);
  const cacheKey = cacheKeyOf(normalized);
  const existing = (await loadRows([normalized])).get(cacheKey);
  const fetchedAt = nowSeconds();
  await db
    .insert(replaceableEvents)
    .values({ ...normalized, event: null, createdAt: null, fetchedAt })
    .onConflictDoUpdate({
      target: [replaceableEvents.pubkey, replaceableEvents.kind, replaceableEvents.dTag],
      set: { fetchedAt },
    });
  setMirror(cacheKey, {
    event: existing?.event ?? null,
    createdAt: existing?.createdAt ?? null,
    fetchedAt,
  });
}

/**
 * Cache-first freshness gate: keys whose row is missing or older than
 * `ttlSeconds` are refreshed from relays; fresh keys cost one batched read and
 * zero network. Stale keys sharing a relay set go out as a single REQ with one
 * merged `{kinds, authors}` filter for plain keys plus one `{kinds, authors,
 * '#d'}` filter per (kind, author) for addressable keys. Missed keys get a
 * negative-cache mark so they aren't re-queried until the TTL lapses.
 */
export async function ensureReplaceableFresh(
  keys: ReplaceableKey[],
  opts: EnsureReplaceableFreshOpts,
): Promise<void> {
  const unique: Required<ReplaceableKey>[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    const normalized = normalizeKey(key);
    const cacheKey = cacheKeyOf(normalized);
    if (!seen.has(cacheKey)) {
      seen.add(cacheKey);
      unique.push(normalized);
    }
  }
  if (unique.length === 0) return;

  const rows = await loadRows(unique);
  const now = nowSeconds();
  const stale = unique.filter((key) => {
    const row = rows.get(cacheKeyOf(key));
    return !row || now - row.fetchedAt >= opts.ttlSeconds;
  });
  if (stale.length === 0) return;

  const waiting: Promise<void>[] = [];
  const toRefresh: Required<ReplaceableKey>[] = [];
  for (const key of stale) {
    const pending = inflight.get(cacheKeyOf(key));
    if (pending) waiting.push(pending);
    else toRefresh.push(key);
  }
  if (toRefresh.length > 0) {
    const refresh = refreshStaleKeys(toRefresh, opts)
      .then((changed) => {
        if (changed) opts.onUpdated?.();
      })
      .finally(() => {
        for (const key of toRefresh) inflight.delete(cacheKeyOf(key));
      });
    for (const key of toRefresh) inflight.set(cacheKeyOf(key), refresh);
    waiting.push(refresh);
  }
  await Promise.all(waiting);
}

type RelayGroup = { relays: string[]; keys: Required<ReplaceableKey>[] };

/** Runs the relay queries for one stale batch; returns true if anything was persisted. */
async function refreshStaleKeys(
  keys: Required<ReplaceableKey>[],
  opts: EnsureReplaceableFreshOpts,
): Promise<boolean> {
  const groups = await resolveRelayGroups(keys, opts.relays);
  const results = await Promise.allSettled(
    groups.map(async (group) => {
      const requested = new Set(group.keys.map(cacheKeyOf));
      const received = new Set<string>();
      if (group.relays.length === 0) throw new RelayQueryError([]);
      const events = await relayPool.query({
        label: 'replaceable-refresh',
        relays: group.relays,
        filters: buildFilters(group.keys),
      });
      for (const event of events) {
        const cacheKey = cacheKeyOfEvent(event);
        if (!requested.has(cacheKey)) continue; // merged filters over-match cross products
        received.add(cacheKey);
        await storeReplaceableEvent(event);
      }
      for (const key of group.keys) {
        if (!received.has(cacheKeyOf(key))) await markReplaceableFetched(key);
      }
    }),
  );
  const failure = results.find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
  return keys.length > 0;
}

/** Groups keys by identical relay set so each group ships as one multi-filter REQ. */
async function resolveRelayGroups(
  keys: Required<ReplaceableKey>[],
  relays: EnsureReplaceableFreshOpts['relays'],
): Promise<RelayGroup[]> {
  if (Array.isArray(relays)) {
    return [{ relays, keys }];
  }
  const resolved = await Promise.all(
    keys.map(async (key) => {
      const urls = await relays(key);
      return { key, urls };
    }),
  );
  const bySignature = new Map<string, RelayGroup>();
  for (const { key, urls } of resolved) {
    const signature = JSON.stringify([...urls].sort());
    let group = bySignature.get(signature);
    if (!group) {
      group = { relays: urls, keys: [] };
      bySignature.set(signature, group);
    }
    group.keys.push(key);
  }
  return [...bySignature.values()];
}

function buildFilters(keys: Required<ReplaceableKey>[]): Filter[] {
  const plainKinds = new Set<number>();
  const plainAuthors = new Set<string>();
  const addressed = new Map<string, { kind: number; pubkey: string; dTags: Set<string> }>();
  for (const key of keys) {
    if (key.dTag === '') {
      plainKinds.add(key.kind);
      plainAuthors.add(key.pubkey);
    } else {
      const groupKey = `${key.kind}:${key.pubkey}`;
      let group = addressed.get(groupKey);
      if (!group) {
        group = { kind: key.kind, pubkey: key.pubkey, dTags: new Set() };
        addressed.set(groupKey, group);
      }
      group.dTags.add(key.dTag);
    }
  }
  const filters: Filter[] = [];
  if (plainKinds.size > 0) {
    filters.push({ kinds: [...plainKinds], authors: [...plainAuthors] });
  }
  for (const group of addressed.values()) {
    filters.push({ kinds: [group.kind], authors: [group.pubkey], '#d': [...group.dTags] });
  }
  return filters;
}
