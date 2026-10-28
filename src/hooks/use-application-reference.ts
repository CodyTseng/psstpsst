import { useCallback, useEffect, useMemo, useState } from 'react';
import type { NostrEventReference } from '@/lib/nostr/event-reference';
import { applicationReferenceEntry, peekApplicationReference, resolveApplicationReference } from '@/services/explore/application-reference';
import type { ExploreEntry } from '@/services/explore/model';
import { useActiveAccount } from '@/stores/active-account.store';

export function useApplicationReference(reference: NostrEventReference, enabled = true) {
  const account = useActiveAccount(state => state.activePubkey);
  const source = useMemo(() => applicationReferenceEntry(reference), [reference]);
  const key = JSON.stringify([account, reference.bech32]);
  const [attempt, setAttempt] = useState({ key, count: 0 });
  const count = attempt.key === key ? attempt.count : 0;
  const [result, setResult] = useState<{ key: string; entry: ExploreEntry | null }>();
  const cached = account && source ? peekApplicationReference(account, source) : undefined;
  const entry = result?.key === key ? result.entry : cached;
  const [pending, setPending] = useState<string>();

  useEffect(() => {
    if (!enabled || !account || !source) return;
    const life = new AbortController();
    void resolveApplicationReference(account, source, life.signal, count > 0).then(value => {
      if (!life.signal.aborted) { setResult({ key, entry: value }); setPending(undefined); }
    }).catch(() => {});
    return () => life.abort();
  }, [account, count, enabled, key, source]);

  const retry = useCallback(() => {
    setPending(key);
    setAttempt(previous => ({ key, count: previous.key === key ? previous.count + 1 : 1 }));
  }, [key]);
  return { entry: entry ?? null, loading: !!account && !!source && (entry === undefined || pending === key), retry };
}
