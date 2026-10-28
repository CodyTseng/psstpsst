import { useMemo } from 'react';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { localApplications, privateListSyncState } from '@/db/schema';
import { useLiveQuery } from '@/db/use-live-query';
import { FAVORITES_D, KIND_APP_FAVORITES, favoriteReference } from '@/services/explore/favorites-protocol';
import type { ExploreEntry } from '@/services/explore/model';

/** Read membership independently of Explore and application metadata loading. */
export function useApplicationMembership(account: string, entry: Pick<ExploreEntry, 'key' | 'kind'>) {
  const local = entry.key.startsWith('local~');
  const reference = useMemo(() => local ? undefined : favoriteReference({ address: entry.key, kind: entry.kind }), [local, entry.key, entry.kind]);
  const saved = useLiveQuery(db.select({ dirty: privateListSyncState.dirty, draft: privateListSyncState.draft,
    snapshot: privateListSyncState.snapshot }).from(privateListSyncState).where(and(
    eq(privateListSyncState.accountPubkey, account), eq(privateListSyncState.kind, KIND_APP_FAVORITES),
    eq(privateListSyncState.dTag, FAVORITES_D))).limit(1), [account, local], { enabled: !!account && !local });
  const installed = useLiveQuery(db.select({ desktopPosition: localApplications.desktopPosition }).from(localApplications).where(and(
    eq(localApplications.accountPubkey, account), eq(localApplications.appId, entry.key))).limit(1),
    [account, entry.key, local], { enabled: !!account && local });
  const error = local ? installed.error : saved.error;
  const added = useMemo(() => {
    if (!account || error) return undefined;
    if (local) return installed.isResolved ? installed.data[0]?.desktopPosition != null : undefined;
    if (!saved.isResolved) return undefined;
    const state = saved.data[0];
    const tags = state?.dirty && state.draft ? state.draft : state?.snapshot?.tags ?? [];
    return tags.some(tag => tag[0] === reference![0] && tag[1] === reference![1]);
  }, [account, error, local, installed.isResolved, installed.data, saved.isResolved, saved.data, reference]);
  return { added, error };
}
