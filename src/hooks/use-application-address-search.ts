import { useEffect, useMemo, useState } from 'react';
import { useExplore } from '@/stores/explore.store';
import { cacheApplicationAddress, type ApplicationAddressCache } from '@/services/explore/discovery';
import { findApplicationAddress, parseApplicationAddressQuery, resolveApplicationAddress } from '@/services/explore/address-search';
import type { ExploreEntry } from '@/services/explore/model';

/** Exact-address search has its own lifetime and never changes catalogue admission or pagination. */
export function useApplicationAddressSearch(account: string, value: string, entries: ExploreEntry[], cache: ApplicationAddressCache) {
  const saved = useExplore();
  const [result, setResult] = useState<{ key: string; entry?: ExploreEntry }>();
  const query = useMemo(() => {
    const parsed = parseApplicationAddressQuery(value);
    // Live text is an unfinished edit; strict validation belongs to explicit opens.
    return parsed?.type === 'invalid' ? null : parsed;
  }, [value]);
  const localEntries = useMemo(() => [...entries, ...(cache.account === account ? cache.entries : []),
    ...(saved.account === account ? saved.entries : [])], [entries, cache, account, saved.account, saved.entries]);
  const local = useMemo(() => findApplicationAddress(query, localEntries), [query, localEntries]);
  const key = `${account}:${value.trim()}`;
  useEffect(() => {
    if (!query || local) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void resolveApplicationAddress(account, query, localEntries, controller.signal).then(entry => {
        if (controller.signal.aborted) return;
        cacheApplicationAddress(account, entry);
        setResult({ key, entry });
      }, () => {
        if (controller.signal.aborted) return;
        setResult({ key });
      });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [account, query, local, localEntries, key]);
  const current = result?.key === key ? result : undefined;
  return { active: query !== null, entry: local ?? current?.entry,
    loading: query !== null && !local && !current };
}
