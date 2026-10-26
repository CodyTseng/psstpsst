import { useEffect, useMemo, useState } from 'react';
import type { ExploreEntry } from '@/services/explore/model';
import { needsFavoriteMetadata, resolveFavoriteMetadata } from '@/services/explore/favorite-metadata';

/** Details never approve or launch a signed reference before verifying its manifest. */
export function useFavoriteMetadata(entry: ExploreEntry | undefined, account: string | null) {
  const key = `${account}:${entry?.key}`;
  const [result, setResult] = useState<{ key: string; entry?: ExploreEntry; error?: string }>();
  const pending = !!entry && needsFavoriteMetadata(entry);
  useEffect(() => {
    if (!entry || !account || !pending) return;
    const controller = new AbortController();
    void resolveFavoriteMetadata(account, entry, controller.signal).then(resolved => {
      if (!controller.signal.aborted) setResult({ key, entry: resolved });
    }, error => {
      if (!controller.signal.aborted) setResult({ key, error: error instanceof Error && error.message.startsWith('napplets.') ? error.message : 'napplets.request_failed' });
    });
    return () => controller.abort();
  }, [entry, account, pending, key]);
  const current = pending && result?.key === key ? result : undefined;
  const resolved = useMemo(() => current?.entry ? { ...current.entry, desktopPosition: entry!.desktopPosition, lastUsedAt: entry!.lastUsedAt } : entry, [current, entry]);
  return { entry: resolved,
    unresolved: pending && !current?.entry, error: current?.error };
}
