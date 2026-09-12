import { and, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { processedGiftWraps, processedSyncRequests, syncCursors } from '@/db/schema';

/**
 * Persistence for the gift-wrap sync engine: the per-account sync cursors and
 * the set of already-unwrapped gift-wrap ids. Kept apart from `dm.service` so
 * the service holds only orchestration, not SQL.
 *
 * Cursors (`sync_cursors`) — two paging frontiers, each advanced only by the
 * paged backfill. Never by a single `since`/`until` query: a relay caps each
 * filter at its default `limit`, so one query can't be trusted to return a whole
 * time range — only page-by-page walking can.
 *   - `backwardUntil` — how far back history backfill has paged. `null` = not
 *     started; `0` = fully backfilled to the beginning of time.
 *   - `forwardSince`  — wall-clock time the *recent* side has been fully paged up
 *     to. The forward backfill drains `(forwardSince, foregroundCutoff]` page by
 *     page, then advances this to that pass's cutoff. It is NOT the live-subscription
 *     anchor (the live tail is a fixed `now - overlap` window) and is NOT advanced
 *     by background notification polling (which only scans a recent overlap window).
 */
export type SyncCursor = {
  forwardSince: number | null;
  backwardUntil: number | null;
};

export async function getSyncCursor(accountPubkey: string): Promise<SyncCursor> {
  const [row] = await db
    .select()
    .from(syncCursors)
    .where(eq(syncCursors.accountPubkey, accountPubkey))
    .limit(1);
  return {
    forwardSince: row?.forwardSince ?? null,
    backwardUntil: row?.backwardUntil ?? null,
  };
}

async function upsertCursor(
  accountPubkey: string,
  patch: Partial<Pick<SyncCursor, 'forwardSince' | 'backwardUntil'>>,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .insert(syncCursors)
    .values({ accountPubkey, ...patch, updatedAt: now })
    .onConflictDoUpdate({
      target: syncCursors.accountPubkey,
      set: { ...patch, updatedAt: now },
    });
}

export function setForwardSince(accountPubkey: string, since: number): Promise<void> {
  return upsertCursor(accountPubkey, { forwardSince: since });
}

export function setBackwardUntil(accountPubkey: string, until: number): Promise<void> {
  return upsertCursor(accountPubkey, { backwardUntil: until });
}

/** True if this gift-wrap id was already unwrapped (so we can skip decryption). */
export async function isGiftWrapProcessed(id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: processedGiftWraps.id })
    .from(processedGiftWraps)
    .where(eq(processedGiftWraps.id, id))
    .limit(1);
  return !!row;
}

export async function markGiftWrapProcessed(
  id: string,
  accountPubkey: string,
): Promise<void> {
  await db
    .insert(processedGiftWraps)
    .values({ id, accountPubkey, processedAt: Math.floor(Date.now() / 1000) })
    .onConflictDoNothing();
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
