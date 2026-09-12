import { useCallback, useEffect, useRef, useState } from 'react';

import { isAbortError } from '@/lib/async/abort';
import type { FileAttachmentMeta } from '@/lib/nostr/file-tags';
import {
  type AttachmentErrorKind,
  type NearbyAttachmentFetchContext,
  attachmentErrorKind,
  fetchAndDecryptAttachment,
  getCachedAttachmentUri,
  getSessionCachedUri,
} from '@/services/files/file-attachment.service';
import { useActiveAccount } from '@/stores/active-account.store';

export type AttachmentState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'loading' }
  | { status: 'paused' }
  | { status: 'ready'; localUri: string }
  | { status: 'error'; kind: AttachmentErrorKind };

export type UseAttachment = {
  state: AttachmentState;
  /** Start a deferred download. */
  load: () => void;
  /** Pause an active resumable download. */
  pause: () => void;
  /** Resume a paused download without changing its integrity decision. */
  resume: () => void;
  /** Re-attempt a failed download (operational failure). */
  retry: () => void;
  /** Proceed past an integrity failure: re-fetch accepting the hash mismatch. */
  reveal: () => void;
};

/**
 * Resolve a kind-15 message's attachment to a usable local file URI.
 * Checks cache first; if missing, normally kicks off a background download +
 * decrypt. `autoLoad: false` stops after the local check until `load()` is
 * called, which keeps message-request bytes behind explicit user intent.
 *
 * In-flight downloads are deduped per-cipher-hash via a module-level map so
 * scrolling past a bubble and back doesn't redownload. A failure carries its
 * {@link AttachmentErrorKind} so the bubble can offer retry (download) or a
 * confirm-to-reveal (integrity); `reveal()` re-runs the fetch bypassing the
 * hash check.
 */
type InFlightAttachment = {
  controller: AbortController;
  promise: Promise<string>;
};

const inFlight = new Map<string, InFlightAttachment>();

export function useAttachment(
  meta: FileAttachmentMeta | null | undefined,
  options?: { autoLoad?: boolean; nearby?: NearbyAttachmentFetchContext },
): UseAttachment {
  const cipherSha = meta?.cipherSha256Hex ?? null;
  const autoLoad = options?.autoLoad ?? true;
  const nearby = options?.nearby;
  const accountPubkey = useActiveAccount((s) => s.activePubkey);
  const [state, setState] = useState<AttachmentState>(() => {
    if (!meta) return { status: 'idle' };
    const sync = getSessionCachedUri(meta);
    if (sync) return { status: 'ready', localUri: sync };
    return { status: 'checking' };
  });
  const resolvedUri = useRef<{ cipherSha: string | null; uri: string } | null>(
    state.status === 'ready' ? { cipherSha, uri: state.localUri } : null,
  );
  // Bumping this re-runs the load effect (retry / reveal); `allowMismatch`
  // carries through to bypass the integrity check on a reveal.
  const [attempt, setAttempt] = useState(0);
  const allowMismatch = useRef(false);
  const activeController = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!meta || !cipherSha) {
      setState({ status: 'idle' });
      return;
    }
    let cancelled = false;
    let controllerForAttempt: AbortController | null = null;

    if (resolvedUri.current?.cipherSha === cipherSha) return;
    function setReady(localUri: string) {
      resolvedUri.current = { cipherSha, uri: localUri };
      setState({ status: 'ready', localUri });
    }

    // First-frame sync hit: nothing async needed.
    const sync = getSessionCachedUri(meta);
    if (sync) {
      setReady(sync);
      return;
    }
    const deferred = !autoLoad && attempt === 0;
    setState((current) => current.status === 'ready' ? current : { status: 'checking' });

    void (async () => {
      try {
        const cached = await getCachedAttachmentUri(meta);
        if (cancelled) return;
        if (cached) {
          setReady(cached);
          return;
        }
        // Message requests must not fetch remote bytes just because a bubble
        // mounted. Still resolve the local store above, then wait for an
        // explicit tap before starting the normal verified download path.
        if (deferred) {
          setState({ status: 'idle' });
          return;
        }
        setState({ status: 'loading' });
        // A reveal must bypass the hash check, so it can't share the dedup map
        // (that promise was a normal, checking fetch). Plain loads still dedup.
        const bypass = allowMismatch.current;
        let active = bypass ? undefined : inFlight.get(cipherSha);
        if (active?.controller.signal.aborted) {
          inFlight.delete(cipherSha);
          active = undefined;
        }
        if (!active) {
          const controller = new AbortController();
          if (bypass) {
            active = {
              controller,
              promise: fetchAndDecryptAttachment(meta, {
                accountPubkey,
                allowIntegrityMismatch: true,
                nearby,
                signal: controller.signal,
              }),
            };
          } else {
            const promise = fetchAndDecryptAttachment(meta, {
              accountPubkey,
              nearby,
              signal: controller.signal,
            }).finally(() => {
              if (inFlight.get(cipherSha)?.controller === controller) inFlight.delete(cipherSha);
            });
            active = { controller, promise };
            inFlight.set(cipherSha, active);
          }
        }
        controllerForAttempt = active.controller;
        activeController.current = active.controller;
        const localUri = await active.promise;
        if (cancelled) return;
        setReady(localUri);
      } catch (err) {
        if (cancelled) return;
        setState(
          isAbortError(err)
            ? { status: 'paused' }
            : { status: 'error', kind: attachmentErrorKind(err) },
        );
      } finally {
        if (activeController.current === controllerForAttempt) activeController.current = null;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cipherSha, accountPubkey, autoLoad, attempt, nearby?.rumorId]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(() => {
    allowMismatch.current = false;
    setAttempt((a) => a + 1);
  }, []);
  const retry = load;
  const pause = useCallback(() => {
    activeController.current?.abort();
    setState((current) => (current.status === 'loading' ? { status: 'paused' } : current));
  }, []);
  const reveal = useCallback(() => {
    allowMismatch.current = true;
    setAttempt((a) => a + 1);
  }, []);
  const resume = useCallback(() => {
    setAttempt((a) => a + 1);
  }, []);

  return { state, load, pause, resume, retry, reveal };
}
