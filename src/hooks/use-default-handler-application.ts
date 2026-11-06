import { useEffect, useMemo, useState } from 'react';
import { applicationEntryFromAddress, peekApplicationReference, resolveApplicationReference } from '@/services/explore/application-reference';
import { findCatalogueHandler, type DefaultHandler } from '@/services/explore/default-handlers';
import type { ExploreEntry } from '@/services/explore/model';

/** Resolve metadata only for visible rows, sharing the application reference cache. */
export function useDefaultHandlerApplication(account: string, preference: DefaultHandler) {
  const { address, sourceId } = preference;
  const source = useMemo(() => applicationEntryFromAddress(address ?? sourceId), [address, sourceId]);
  const fallback = useMemo(() => ({ key: sourceId, servers: [] }), [sourceId]);
  const key = JSON.stringify([account, sourceId, address]);
  const [result, setResult] = useState<{ key: string; entry: ExploreEntry | null }>();
  const catalogue = findCatalogueHandler(preference.type, sourceId);
  const cached = source ? peekApplicationReference(account, source) : undefined;
  useEffect(() => {
    if (!source || catalogue) return;
    const life = new AbortController();
    void resolveApplicationReference(account, source, life.signal).then(entry => {
      if (!life.signal.aborted) setResult({ key, entry });
    }).catch(() => {});
    return () => life.abort();
  }, [account, catalogue, key, source]);
  return catalogue ?? (result?.key === key ? result.entry : cached) ?? source ?? fallback;
}
