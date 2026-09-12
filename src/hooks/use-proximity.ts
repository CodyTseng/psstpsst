import { and, eq, isNotNull } from 'drizzle-orm';

import { db } from '@/db/client';
import { devicePreferences, proximityAccounts, proximityPeers } from '@/db/schema';
import { useLiveQuery } from '@/db/use-live-query';
import { proximityEnabledPreferenceKey } from '@/services/proximity/proximity-preferences';

/**
 * The account's own proximity identity row (`proximity_accounts` is keyed by
 * account, so at most one row exists). `identity` is null until the live query
 * resolves — use `loaded` to tell "still loading" from "no identity yet".
 */
export function useProximityIdentity(
  accountPubkey: string | null | undefined,
  liveDataEnabled = true,
) {
  const safePubkey = accountPubkey ?? '';
  const { data, updatedAt } = useLiveQuery(
    db
      .select()
      .from(proximityAccounts)
      .where(eq(proximityAccounts.accountPubkey, safePubkey))
      .limit(1),
    [safePubkey, liveDataEnabled],
    { enabled: liveDataEnabled },
  );
  return { identity: data?.[0] ?? null, loaded: updatedAt !== undefined };
}

/** Whether the nearby feature is switched on for this account (device-local preference). */
export function useProximityEnabledPreference(accountPubkey: string | null | undefined) {
  const { data } = useLiveQuery(
    db
      .select({ value: devicePreferences.value })
      .from(devicePreferences)
      .where(eq(devicePreferences.key, proximityEnabledPreferenceKey(accountPubkey ?? ''))),
    [accountPubkey],
  );
  return data?.[0]?.value === '1';
}

/**
 * Live read of a single proximity peer. A null/empty key queries a sentinel
 * (`__none__`) that matches nothing, so the hook can stay mounted while the
 * peer is unknown. `peer` is validated against the requested keys because
 * `useLiveQuery` retains the previous dependency set briefly — without the
 * check, a key switch could hand out the stale peer for a frame.
 */
export function useProximityPeer(
  accountPubkey: string,
  proximityPubkey: string | null | undefined,
  liveDataEnabled = true,
) {
  const queryEnabled = liveDataEnabled && !!accountPubkey && !!proximityPubkey;
  const { data, updatedAt } = useLiveQuery(
    db
      .select()
      .from(proximityPeers)
      .where(
        and(
          eq(proximityPeers.accountPubkey, accountPubkey || '__none__'),
          eq(proximityPeers.proximityPubkey, proximityPubkey ?? '__none__'),
        ),
      )
      .limit(1),
    [accountPubkey, proximityPubkey, queryEnabled],
    { enabled: queryEnabled },
  );
  const peer =
    data?.find(
      (row) => row.accountPubkey === accountPubkey && row.proximityPubkey === proximityPubkey,
    ) ?? null;
  return { peer, loaded: updatedAt !== undefined };
}

/** The account's device-local proximity block list (pubkey + names only). */
export function useBlockedProximityPeers(accountPubkey: string) {
  const { data, updatedAt } = useLiveQuery(
    db
      .select({
        proximityPubkey: proximityPeers.proximityPubkey,
        displayName: proximityPeers.displayName,
        nickname: proximityPeers.nickname,
      })
      .from(proximityPeers)
      .where(
        and(
          eq(proximityPeers.accountPubkey, accountPubkey || '__none__'),
          isNotNull(proximityPeers.blockedAt),
        ),
      ),
    [accountPubkey],
  );
  return { peers: data, loaded: updatedAt !== undefined };
}

/**
 * All stored proximity peers for the account, with the fields the nearby
 * screen merges into its live peer list.
 */
export function useProximityPeers(accountPubkey: string) {
  const { data, updatedAt } = useLiveQuery(
    db
      .select({
        proximityPubkey: proximityPeers.proximityPubkey,
        displayName: proximityPeers.displayName,
        nickname: proximityPeers.nickname,
        lastSeenAt: proximityPeers.lastSeenAt,
        connectedAt: proximityPeers.connectedAt,
        blockedAt: proximityPeers.blockedAt,
        connectionFailure: proximityPeers.connectionFailure,
      })
      .from(proximityPeers)
      .where(eq(proximityPeers.accountPubkey, accountPubkey)),
    [accountPubkey],
  );
  return { peers: data, loaded: updatedAt !== undefined };
}
