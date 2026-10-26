import { useCallback, useEffect, useMemo } from 'react';
import { useIsFocused } from 'expo-router';
import { useStore } from 'zustand';
import { ExploreHistory } from '@/services/explore/history';
import { subscribeExploreVisits } from '@/services/explore/visits';
import { platform } from '@/platform';
import type { ExploreEntry } from '@/services/explore/model';

export function useExploreHistory(account: string | null) {
  const focused = useIsFocused();
  const history = useMemo(() => new ExploreHistory(account ?? ''), [account]);
  const state = useStore(history.store);
  useEffect(() => {
    if (!account || !focused) return;
    void history.open();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { history.reset(); void history.open(); }, 40);
    };
    const stopVisits = subscribeExploreVisits(visit => { if (visit.accountPubkey === account) refresh(); });
    const stopDatabase = platform.database?.addChangeListener?.(event => {
      if (event.external && event.tableName === 'explore_history') refresh();
    });
    return () => {
      if (timer) clearTimeout(timer);
      stopVisits(); stopDatabase?.(); history.reset();
    };
  }, [account, focused, history]);
  const loadMore = useCallback(() => history.loadMore(), [history]);
  const remove = useCallback((entry: ExploreEntry) => history.remove(entry), [history]);
  return { ...state, loadMore, remove };
}
