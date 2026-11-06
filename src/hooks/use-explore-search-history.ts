import { useEffect, useMemo, useState } from 'react';
import { matchSearchHistory, readSearchHistory } from '@/services/explore/search-history';
import { subscribeExploreVisits } from '@/services/explore/visits';
import { platform } from '@/platform';

export function useExploreSearchHistory(account: string | null, active: boolean, query: string) {
  const [history, setHistory] = useState<{ account: string | null; addresses: string[] }>({ account: null, addresses: [] });
  useEffect(() => {
    if (!account || !active) return;
    let cancelled = false;
    let revision = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = () => {
      const started = ++revision;
      void readSearchHistory(account).then(addresses => {
        if (!cancelled && started === revision) setHistory({ account, addresses });
      }).catch(error => console.warn('[explore] Failed to read website history', error));
    };
    const refresh = () => {
      if (timer) clearTimeout(timer);
      // Invalidate pending reads immediately, before the next batched refresh.
      revision++;
      timer = setTimeout(read, 40);
    };
    read();
    const stopVisits = subscribeExploreVisits(visit => { if (visit.accountPubkey === account) refresh(); });
    const stopDatabase = platform.database?.addChangeListener?.(event => {
      if (event.tableName === 'explore_history') refresh();
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      stopVisits(); stopDatabase?.();
    };
  }, [account, active]);
  const suggestions = useMemo(() => active && history.account === account ? matchSearchHistory(history.addresses, query) : [], [active, history, account, query]);
  return { suggestions };
}
