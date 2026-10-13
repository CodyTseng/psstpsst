import { and, eq, inArray } from 'drizzle-orm';

import { db } from '@/db/client';
import { normalizeRelayUrl } from '@/lib/nostr/relay-url';
import { canReceiveForAccount } from '../account/account-receive-guard';
import { processedGiftWraps, processedSyncRequests, syncCursors } from '@/db/schema';
import type { ForwardSyncScan } from '@/db/schema/sync-cursors';

/** Durable paging frontiers belong to one account and one normalized relay.
 * Account-wide coverage is only a conservative read model for group admission;
 * it never drives relay paging or prevents another relay from progressing. */
export type SyncCursor = {
  forwardSince: number | null;
  backwardUntil: number | null;
};

type StoredSyncCursor = SyncCursor & { pendingForward: ForwardSyncScan | null };
const cursorCache = new Map<string, Map<string, StoredSyncCursor>>();
const cursorLoads = new Map<string, Promise<Map<string, StoredSyncCursor>>>();
const cursorSeeds = new Map<string, Map<string, Promise<SyncCursor>>>();
const activeRelays = new Map<string, string[]>();
const emptyCursor = (): SyncCursor => ({ forwardSince: null, backwardUntil: null });

/** Invalidate coverage before live intake when routing adds an unseen relay. */
export function configureSyncRelays(accountPubkey: string, relays: string[]): void {
  activeRelays.set(accountPubkey, Array.from(new Set(relays.map(normalizeRelayUrl))));
}

export function peekSyncCursor(accountPubkey: string): SyncCursor | undefined {
  const cached = cursorCache.get(accountPubkey);
  if (!cached) return undefined;
  const relays = activeRelays.get(accountPubkey) ?? Array.from(cached.keys());
  if (relays.length === 0) return emptyCursor();
  let forwardSince: number | null = Infinity;
  let backwardUntil: number | null = 0;
  for (const relay of relays) {
    const cursor = cached.get(relay) ?? emptyCursor();
    forwardSince = forwardSince === null || cursor.forwardSince === null
      ? null : Math.min(forwardSince, cursor.forwardSince);
    backwardUntil = backwardUntil === null || cursor.backwardUntil === null
      ? null : Math.max(backwardUntil, cursor.backwardUntil);
  }
  return { forwardSince, backwardUntil };
}

async function loadCursors(accountPubkey: string): Promise<Map<string, StoredSyncCursor>> {
  const cached = cursorCache.get(accountPubkey);
  if (cached) return cached;
  const pending = cursorLoads.get(accountPubkey);
  if (pending) return pending;
  const task = db.select().from(syncCursors)
    .where(eq(syncCursors.accountPubkey, accountPubkey))
    .then(async rows => {
      const normalized = new Map<string, typeof rows[number]>();
      const aliases: string[] = [];
      for (const row of rows) {
        let url: string;
        try { url = normalizeRelayUrl(row.relayUrl); } catch { continue; }
        if (url !== row.relayUrl) aliases.push(row.relayUrl);
        const previous = normalized.get(url);
        normalized.set(url, previous ? {
          ...row, relayUrl: url,
          forwardSince: previous.forwardSince === null || row.forwardSince === null
            ? null : Math.min(previous.forwardSince, row.forwardSince),
          backwardUntil: previous.backwardUntil === null || row.backwardUntil === null
            ? null : Math.max(previous.backwardUntil, row.backwardUntil),
          // A merged frontier may have a different floor; safely restart its scan.
          pendingForward: null,
          updatedAt: Math.max(previous.updatedAt, row.updatedAt),
        } : { ...row, relayUrl: url });
      }
      // Migrate only this account's small relay cursor set, never message history.
      // Collisions keep conservative coverage so normalization cannot skip pages.
      if (aliases.length > 0) await db.transaction(async tx => {
        for (const row of normalized.values()) {
          await tx.insert(syncCursors).values(row).onConflictDoUpdate({
            target: [syncCursors.accountPubkey, syncCursors.relayUrl],
            set: { forwardSince: row.forwardSince, backwardUntil: row.backwardUntil,
              pendingForward: row.pendingForward, updatedAt: row.updatedAt },
          });
        }
        await tx.delete(syncCursors).where(and(
          eq(syncCursors.accountPubkey, accountPubkey), inArray(syncCursors.relayUrl, aliases),
        ));
      });
      const cursors = new Map([...normalized].map(([url, row]) => [url, {
        forwardSince: row.forwardSince, backwardUntil: row.backwardUntil,
        pendingForward: row.pendingForward,
      }]));
      if (cursorLoads.get(accountPubkey) === task) cursorCache.set(accountPubkey, cursors);
      return cursors;
    });
  cursorLoads.set(accountPubkey, task);
  try { return await task; }
  finally { if (cursorLoads.get(accountPubkey) === task) cursorLoads.delete(accountPubkey); }
}

/** Shared conservative coverage for group membership finalization. */
export async function getSyncCursor(accountPubkey: string): Promise<SyncCursor> {
  await loadCursors(accountPubkey);
  return peekSyncCursor(accountPubkey) ?? emptyCursor();
}

export async function getRelaySyncCursor(accountPubkey: string, relayUrl: string): Promise<SyncCursor> {
  relayUrl = normalizeRelayUrl(relayUrl);
  const cursors = await loadCursors(accountPubkey);
  const existing = cursors.get(relayUrl);
  if (existing) return { forwardSince: existing.forwardSince, backwardUntil: existing.backwardUntil };
  let seeds = cursorSeeds.get(accountPubkey);
  if (!seeds) {
    seeds = new Map();
    cursorSeeds.set(accountPubkey, seeds);
  }
  const pending = seeds.get(relayUrl);
  if (pending) return pending;
  const inherited = inheritLeastCoveredCursor(accountPubkey, cursors);
  const task = db.insert(syncCursors).values({
    accountPubkey, relayUrl, ...inherited, updatedAt: Math.floor(Date.now() / 1000),
  }).onConflictDoNothing().then(() => {
    const cursor = cursors.get(relayUrl) ?? inherited;
    if (cursorCache.get(accountPubkey) === cursors && !cursors.has(relayUrl)) {
      cursors.set(relayUrl, { ...cursor, pendingForward: null });
    }
    return { forwardSince: cursor.forwardSince, backwardUntil: cursor.backwardUntil };
  }).finally(() => {
    if (seeds.get(relayUrl) === task) seeds.delete(relayUrl);
    if (seeds.size === 0 && cursorSeeds.get(accountPubkey) === seeds) cursorSeeds.delete(accountPubkey);
  });
  seeds.set(relayUrl, task);
  return task;
}

/** Copy one complete cursor pair, prioritizing existing configured replicas.
 * Unknown coverage is smallest; otherwise compare the covered interval length.
 * Stored replicas remain a fallback when the entire DM relay set is replaced. */
function inheritLeastCoveredCursor(accountPubkey: string, cursors: Map<string, SyncCursor>): SyncCursor {
  const configured = activeRelays.get(accountPubkey);
  const hasConfiguredCursor = configured?.some(url => cursors.has(url));
  const candidates = hasConfiguredCursor ? new Set(configured) : undefined;
  let source: SyncCursor | undefined;
  let sourceUrl = '';
  let smallest = Infinity;
  for (const [url, cursor] of cursors) {
    if (candidates && !candidates.has(url)) continue;
    const coverage = cursor.forwardSince === null || cursor.backwardUntil === null
      ? -Infinity : Math.max(0, cursor.forwardSince - cursor.backwardUntil);
    const forward = cursor.forwardSince ?? -Infinity;
    const sourceForward = source?.forwardSince ?? -Infinity;
    if (!source || coverage < smallest || (coverage === smallest &&
      (forward < sourceForward || (forward === sourceForward && url < sourceUrl)))) {
      source = cursor;
      sourceUrl = url;
      smallest = coverage;
    }
  }
  return source ? { forwardSince: source.forwardSince, backwardUntil: source.backwardUntil } : emptyCursor();
}

async function upsertCursor(
  accountPubkey: string,
  relayUrl: string,
  patch: Partial<StoredSyncCursor>,
): Promise<void> {
  relayUrl = normalizeRelayUrl(relayUrl);
  const cursors = await loadCursors(accountPubkey);
  const updatedAt = Math.floor(Date.now() / 1000);
  await db.insert(syncCursors).values({
    accountPubkey, relayUrl, ...patch, updatedAt,
  }).onConflictDoUpdate({
    target: [syncCursors.accountPubkey, syncCursors.relayUrl],
    set: { ...patch, updatedAt },
  });
  cursors.set(relayUrl, { ...(cursors.get(relayUrl) ?? { ...emptyCursor(), pendingForward: null }), ...patch });
}

export function clearSyncCursorCache(accountPubkey: string): void {
  cursorCache.delete(accountPubkey);
  cursorLoads.delete(accountPubkey);
  cursorSeeds.delete(accountPubkey);
  activeRelays.delete(accountPubkey);
}

export function setForwardSince(accountPubkey: string, relayUrl: string, since: number): Promise<void> {
  // Commit coverage and clear its checkpoint in the same atomic row write.
  return upsertCursor(accountPubkey, relayUrl, { forwardSince: since, pendingForward: null });
}

export async function getPendingForwardScan(accountPubkey: string, relayUrl: string): Promise<ForwardSyncScan | null> {
  const cursors = await loadCursors(accountPubkey);
  return cursors.get(normalizeRelayUrl(relayUrl))?.pendingForward ?? null;
}

/** Persist only after the page's intake has finished and wire EOSE confirms it. */
export function setPendingForwardScan(
  accountPubkey: string, relayUrl: string, scan: ForwardSyncScan,
): Promise<void> {
  return upsertCursor(accountPubkey, relayUrl, { pendingForward: scan });
}

export function setBackwardUntil(accountPubkey: string, relayUrl: string, until: number): Promise<void> {
  return upsertCursor(accountPubkey, relayUrl, { backwardUntil: until });
}

/** True if this gift-wrap id was already unwrapped (so we can skip decryption). */
export async function isGiftWrapProcessed(id: string, accountPubkey?: string): Promise<boolean> {
  const [row] = await db
    .select({ id: processedGiftWraps.id })
    .from(processedGiftWraps)
    .where(accountPubkey
      ? and(eq(processedGiftWraps.id, id), eq(processedGiftWraps.accountPubkey, accountPubkey))
      : eq(processedGiftWraps.id, id))
    .limit(1);
  return !!row;
}

/** Return the processed subset of a relay page in bounded SQLite queries. */
export async function getProcessedGiftWrapIds(ids: string[]): Promise<Set<string>> {
  const processed = new Set<string>();
  const querySize = 400;
  for (let start = 0; start < ids.length; start += querySize) {
    const rows = await db
      .select({ id: processedGiftWraps.id })
      .from(processedGiftWraps)
      .where(inArray(processedGiftWraps.id, ids.slice(start, start + querySize)));
    for (const row of rows) processed.add(row.id);
  }
  return processed;
}

export async function markGiftWrapProcessed(
  id: string,
  accountPubkey: string,
  checkAccountOwnership = false,
): Promise<void> {
  const persist = async (tx: typeof db) => {
    await tx.insert(processedGiftWraps)
      .values({ id, accountPubkey, processedAt: Math.floor(Date.now() / 1000) })
      .onConflictDoNothing();
  };
  if (checkAccountOwnership) {
    await db.transaction(async (tx) => {
      if (await canReceiveForAccount(accountPubkey, tx)) await persist(tx);
    });
  } else await persist(db);
}

/** True if this kind-4454 key-sync request id was already handled — sent,
 * dismissed, or one we issued ourselves — so its approval prompt doesn't
 * (re-)fire. Persisted (not in-memory) so it survives the re-init after a
 * transfer succeeds: that's what lets a device recognise its *own* request, the
 * ephemeral client key it announced with being long gone by then. */
export async function isSyncRequestProcessed(
  accountPubkey: string,
  eventId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: processedSyncRequests.eventId })
    .from(processedSyncRequests)
    .where(
      and(
        eq(processedSyncRequests.accountPubkey, accountPubkey),
        eq(processedSyncRequests.eventId, eventId),
      ),
    )
    .limit(1);
  return !!row;
}

export async function markSyncRequestProcessed(
  accountPubkey: string,
  eventId: string,
): Promise<void> {
  await db
    .insert(processedSyncRequests)
    .values({ eventId, accountPubkey, processedAt: Math.floor(Date.now() / 1000) })
    .onConflictDoNothing();
}
