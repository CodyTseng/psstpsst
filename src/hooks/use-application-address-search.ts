import { useCallback, useEffect, useMemo, useState } from 'react';
import { useExplore } from '@/stores/explore.store';
import { cacheApplicationAddress, type ApplicationAddressCache } from '@/services/explore/discovery';
import { findApplicationAddress, parseApplicationAddressQuery, resolveApplicationAddress } from '@/services/explore/address-search';
import type { ExploreEntry } from '@/services/explore/model';

/** Exact-address search has its own lifetime and never changes catalogue admission or pagination. */
export function useApplicationAddressSearch(account: string, value: string, entries: ExploreEntry[], cache: ApplicationAddressCache) {
  const saved = useExplore();
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; entry?: ExploreEntry; error?: string }>();
  const query = useMemo(() => parseApplicationAddressQuery(value), [value]);
  const localEntries = useMemo(() => [...entries, ...(cache.account === account ? cache.entries : []),
    ...(saved.account === account ? saved.entries : [])], [entries, cache, account, saved.account, saved.entries]);
  const local = useMemo(() => findApplicationAddress(query, localEntries), [query, localEntries]);
  const key = `${account}:${retry}:${value.trim()}`;
  useEffect(() => {
    if (!query || query.type === 'invalid' || local) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void resolveApplicationAddress(account, query, localEntries, controller.signal).then(entry => {
        if (controller.signal.aborted) return;
        cacheApplicationAddress(account, entry);
        setResult({ key, entry });
      }, error => {
        if (controller.signal.aborted) return;
        const code = error instanceof Error && ['napplets.not_found', 'napplets.invalid_manifest'].includes(error.message)
          ? error.message : 'napplets.request_failed';
        setResult({ key, error: code });
      });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [account, query, local, localEntries, key]);
  const current = result?.key === key ? result : undefined;
  return { active: query !== null, entry: local ?? current?.entry,
    loading: query !== null && query.type !== 'invalid' && !local && !current,
    error: query?.type === 'invalid' ? 'napplets.invalid_manifest' : local ? undefined : current?.error,
    retry: useCallback(() => setRetry(count => count + 1), []) };
}
