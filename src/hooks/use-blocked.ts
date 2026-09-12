import { and, desc, eq } from 'drizzle-orm';
import { useLiveQuery } from '@/db/use-live-query';

import { db } from '@/db/client';
import { blockedUsers } from '@/db/schema';

type BlockedLookupRow = {
  accountPubkey: string;
  pubkey: string;
};

export function resolveBlockedStatus(
  data: readonly BlockedLookupRow[],
  isResolved: boolean,
  accountPubkey: string,
  pubkey: string,
): boolean | undefined {
  if (!isResolved) return undefined;
  const row = data[0];
  if (row && (row.accountPubkey !== accountPubkey || row.pubkey !== pubkey)) {
    return undefined;
  }
  return row != null;
}

/**
 * Live list of the account's blocked pubkeys, most-recently-blocked first.
 * `loaded` is false until the query first resolves — callers gate the empty
 * state on `loaded` (not `length`) to avoid flashing "no blocked users" while
 * the query is still in flight (DESIGN §12 rule 17).
 */
export function useBlockedUsers(accountPubkey: string) {
  const { data, isResolved } = useLiveQuery(
    db
      .select({ pubkey: blockedUsers.pubkey, blockedAt: blockedUsers.blockedAt })
      .from(blockedUsers)
      .where(eq(blockedUsers.accountPubkey, accountPubkey))
      .orderBy(desc(blockedUsers.blockedAt)),
    [accountPubkey],
  );
  return { blocked: data ?? [], loaded: isResolved };
}

/**
 * Whether `pubkey` is currently blocked. `undefined` until the live query has
 * resolved, then `true` / `false` — so callers can avoid flashing the wrong
 * label (e.g. "Block" vs "Unblock") during the brief window before the answer
 * is known.
 */
export function useIsBlocked(
  accountPubkey: string,
  pubkey: string,
  liveDataEnabled = true,
): boolean | undefined {
  const queryEnabled = liveDataEnabled && !!accountPubkey && !!pubkey;
  const { data, isResolved } = useLiveQuery(
    db
      .select({ accountPubkey: blockedUsers.accountPubkey, pubkey: blockedUsers.pubkey })
      .from(blockedUsers)
      .where(and(eq(blockedUsers.accountPubkey, accountPubkey), eq(blockedUsers.pubkey, pubkey)))
      .limit(1),
    [accountPubkey, pubkey, queryEnabled],
    { enabled: queryEnabled },
  );
  return resolveBlockedStatus(data, isResolved, accountPubkey, pubkey);
}
