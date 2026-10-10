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
import { attachmentDownloadTaskKey, subscribeAttachmentDownload, type DownloadTask } from '@/services/files/attachment-download-task';
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
 * Shared tasks notify every mounted consumer when an attempt starts or is
 * replaced, and publish the resulting URI. Integrity overrides remain separate
 * from verified downloads.
 */
export function useAttachment(
  meta: FileAttachmentMeta | null | undefined,
  options?: { autoLoad?: boolean; nearby?: NearbyAttachmentFetchContext },
): UseAttachment {
  const cipherSha = meta?.cipherSha256Hex ?? null;
  const url = meta?.url ?? null;
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
    let observed: DownloadTask | null = null;
    let detachAbort: (() => void) | undefined;

    function setReady(localUri: string) {
      resolvedUri.current = { cipherSha, uri: localUri };
      setState({ status: 'ready', localUri });
    }
    if (resolvedUri.current?.cipherSha === cipherSha) return;
    const sync = getSessionCachedUri(meta);
    if (sync) {
      setReady(sync);
      return;
    }

    function observe(task: DownloadTask) {
      detachAbort?.();
      observed = task;
      activeController.current = task.controller;
      setState({ status: 'loading' });
      const paused = () => {
        if (!cancelled && observed === task) setState({ status: 'paused' });
      };
      task.controller.signal.addEventListener('abort', paused, { once: true });
      detachAbort = () => task.controller.signal.removeEventListener('abort', paused);
      void task.promise.then(
        (uri) => {
          if (cancelled || observed !== task) return;
          if (task.controller.signal.aborted) paused();
          else setReady(uri);
        },
        (error) => {
          if (cancelled || observed !== task) return;
          setState(task.controller.signal.aborted || isAbortError(error)
            ? { status: 'paused' }
            : { status: 'error', kind: attachmentErrorKind(error) });
        },
      );
    }
    // Subscribe by crypto metadata as well as URL: an integrity override must
    // never reveal unverified bytes to consumers that did not approve it.
    const unsubscribe = subscribeAttachmentDownload(
      attachmentDownloadTaskKey(accountPubkey, meta, allowMismatch.current), observe,
    );
    const deferred = !autoLoad && attempt === 0;
    if (!observed) setState({ status: 'checking' });
    void (async () => {
      try {
        const cached = await getCachedAttachmentUri(meta);
        if (cancelled || observed) return;
        if (cached) {
          setReady(cached);
          return;
        }
        if (deferred) {
          setState({ status: 'idle' });
          return;
        }
        // The service starts and publishes the task synchronously; its observer
        // owns state transitions, including replacement attempts from siblings.
        void fetchAndDecryptAttachment(meta, {
          accountPubkey, nearby, allowIntegrityMismatch: allowMismatch.current,
        }).catch(() => {});
      } catch (error) {
        if (!cancelled && !observed) setState({ status: 'error', kind: attachmentErrorKind(error) });
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe();
      detachAbort?.();
      if (activeController.current === observed?.controller) activeController.current = null;
    };
  }, [cipherSha, url, accountPubkey, autoLoad, attempt, nearby?.rumorId]); // eslint-disable-line react-hooks/exhaustive-deps

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
