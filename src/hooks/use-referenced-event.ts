import type { Event } from 'nostr-tools';
import { useEffect, useState } from 'react';

import type { NostrEventReference } from '@/lib/nostr/event-reference';
import {
  canResolveReferencedEvent,
  fetchReferencedEvent,
  getCachedReferencedEvent,
} from '@/services/nostr/event-reference.service';

type ReferencedEventState = {
  event: Event | null;
  loading: boolean;
};

export function useReferencedEvent(reference: NostrEventReference, enabled = true): ReferencedEventState {
  const key = reference.bech32;
  const resolvable = canResolveReferencedEvent(reference);
  const [result, setResult] = useState<ReferencedEventState & { key: string }>(() => {
    if (!resolvable) return { key, event: null, loading: false };
    const cached = getCachedReferencedEvent(reference);
    return cached === undefined
      ? { key, event: null, loading: true }
      : { key, event: cached, loading: false };
  });

  // A virtualized row may be recycled for a different message before the
  // effect runs. Ignore the previous key's result immediately, without a
  // synchronous reset effect and its extra render.
  const nextCached =
    result.key === key ? undefined : resolvable ? getCachedReferencedEvent(reference) : null;
  const state: ReferencedEventState =
    result.key === key
      ? result
      : nextCached === undefined
        ? { event: null, loading: true }
        : { event: nextCached, loading: false };

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    if (!resolvable) {
      queueMicrotask(() => {
        if (active) setResult({ key, event: null, loading: false });
      });
      return () => {
        active = false;
      };
    }
    const cached = getCachedReferencedEvent(reference);
    if (cached !== undefined) {
      // Commit after the effect body so a recycled row can adopt an already-
      // cached key without a synchronous cascading render.
      queueMicrotask(() => {
        if (active) setResult({ key, event: cached, loading: false });
      });
      return () => {
        active = false;
      };
    }
    void fetchReferencedEvent(reference)
      .then((event) => {
        if (active) setResult({ key, event, loading: false });
      })
      .catch(() => {
        if (active) setResult({ key, event: null, loading: false });
      });
    return () => {
      active = false;
    };
  }, [enabled, key, reference, resolvable]);

  return state;
}
