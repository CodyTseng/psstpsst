import { eq, inArray } from 'drizzle-orm';
import { useLiveQuery } from '@/db/use-live-query';
import { useEffect, useMemo } from 'react';

import { db } from '@/db/client';
import { profiles } from '@/db/schema';
import {
  fetchProfile,
  fetchProfiles,
  PROFILE_TTL_SECONDS,
} from '@/services/profile/profile.service';

type ProfileRow = typeof profiles.$inferSelect;

/**
 * Session-memory profile cache. Resolved live queries seed it so revisiting a
 * profile can paint without waiting for another database round trip. Cold reads
 * remain asynchronous so no database backend is required to block rendering.
 */
const profileCache = new Map<string, ProfileRow>();

/** Memory-only profile lookup for the first real chat commit. Unlike
 * `warmProfile`, this never touches SQLite during a navigation render. */
export function getSessionCachedProfile(pubkey: string): ProfileRow | null {
  return profileCache.get(pubkey) ?? null;
}

/** Cache-only warm read; database access remains asynchronous. */
function warmProfile(pubkey: string): ProfileRow | null {
  return profileCache.get(pubkey) ?? null;
}

export function useProfile(
  pubkey: string | null | undefined,
  liveDataEnabled = true,
): ProfileRow | null {
  const safePubkey = pubkey ?? '__none__';
  const queryEnabled = liveDataEnabled && !!pubkey;
  const query = useLiveQuery(
    db.select().from(profiles).where(eq(profiles.pubkey, safePubkey)).limit(1),
    [safePubkey, queryEnabled],
    { enabled: queryEnabled },
  );
  // `useLiveQuery` keeps its *previous* rows for a frame after `safePubkey`
  // changes (e.g. an account switch) until the new query resolves — so the row
  // in hand can still belong to the *old* pubkey. Trusting it would seed the warm
  // cache with the wrong profile under the new key (`profileCache[newPubkey] =
  // oldRow`); and for a pubkey that has no profile of its own, that poisoned entry
  // is never overwritten by a live result, so the new account would show the
  // *previous* account's name + avatar indefinitely (the account-switch display
  // bug). Only accept a row that actually matches the pubkey we asked for.
  const liveRow = query.data?.[0] ?? null;
  const live = liveRow && liveRow.pubkey === safePubkey ? liveRow : null;

  // First frame: the live query hasn't resolved yet, so fall back to the warm
  // session cache instead of null — that's what stops
  // a known person's name from flashing through the npub fallback on entry.
  const profile = useMemo(() => {
    if (live) {
      profileCache.set(safePubkey, live);
      return live;
    }
    return pubkey ? warmProfile(safePubkey) : null;
  }, [live, pubkey, safePubkey]);

  useEffect(() => {
    if (!pubkey || !liveDataEnabled) return;
    const now = Math.floor(Date.now() / 1000);
    const stale = !profile || now - profile.fetchedAt > PROFILE_TTL_SECONDS;
    if (stale) {
      void fetchProfile(pubkey).catch(() => {
        // The cached profile remains usable; a later render retries stale data.
      });
    }
  }, [pubkey, profile, liveDataEnabled]);

  return profile;
}

/**
 * Bulk-load profiles for a set of pubkeys. Returns a map and triggers a
 * single batched REQ for any missing or stale entries.
 */
export function useProfilesMap(
  pubkeys: string[],
  liveDataEnabled = true,
): Record<string, ProfileRow> {
  const uniqueKey = useMemo(
    () => Array.from(new Set(pubkeys)).sort().join(','),
    [pubkeys],
  );
  const uniquePubkeys = useMemo(
    () => (uniqueKey ? uniqueKey.split(',') : []),
    [uniqueKey],
  );
  const queryEnabled = liveDataEnabled && uniquePubkeys.length > 0;

  const { data } = useLiveQuery(
    uniquePubkeys.length > 0
      ? db.select().from(profiles).where(inArray(profiles.pubkey, uniquePubkeys))
      : db.select().from(profiles).where(eq(profiles.pubkey, '__none__')),
    [uniqueKey, queryEnabled],
    { enabled: queryEnabled },
  );

  const map = useMemo(() => {
    const m: Record<string, ProfileRow> = {};
    // Warm from memory only. Render must never depend on a synchronous database
    // round trip.
    for (const pk of uniquePubkeys) {
      const cached = profileCache.get(pk);
      if (cached) m[pk] = cached;
    }
    // Live results win and refresh the cache.
    for (const p of data ?? []) {
      m[p.pubkey] = p;
      profileCache.set(p.pubkey, p);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, uniqueKey]);

  useEffect(() => {
    if (uniquePubkeys.length === 0 || !liveDataEnabled) return;
    const now = Math.floor(Date.now() / 1000);
    const stalePubkeys = uniquePubkeys.filter((pk) => {
      const p = map[pk];
      return !p || now - p.fetchedAt > PROFILE_TTL_SECONDS;
    });
    if (stalePubkeys.length === 0) return;
    void fetchProfiles(stalePubkeys).catch(() => {
      // Profile refresh is best-effort; existing cached rows stay visible.
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uniqueKey, liveDataEnabled]);

  return map;
}
