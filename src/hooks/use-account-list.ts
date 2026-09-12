import { asc } from 'drizzle-orm';
import { useLiveQuery } from '@/db/use-live-query';

import { db } from '@/db/client';
import { accounts } from '@/db/schema';

export type AccountRow = typeof accounts.$inferSelect;

/**
 * Every account stored on this device, in the user's **manual order** (ascending
 * `sortOrder`) — the source for the account switcher and the account manager.
 * Live, so adding/removing/reordering updates the UI without a manual refresh.
 * Deliberately *not* sorted by recency: the list must stay put across switches
 * so the user can pick by muscle memory.
 */
export function useAccountList(): AccountRow[] {
  const query = useLiveQuery(db.select().from(accounts).orderBy(asc(accounts.sortOrder)));
  return query.data ?? [];
}
