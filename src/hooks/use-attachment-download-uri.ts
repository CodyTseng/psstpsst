import { useEffect, useState } from 'react';

import type { FileAttachmentMeta } from '@/lib/nostr/file-tags';
import {
  attachmentDownloadTaskKey,
  subscribeAttachmentDownload,
  type DownloadTask,
} from '@/services/files/attachment-download-task';
import { useActiveAccount } from '@/stores/active-account.store';

/** Observe verified task completion without initiating downloads or playback. */
export function useAttachmentDownloadUri(meta: FileAttachmentMeta): string | null {
  const accountPubkey = useActiveAccount((state) => state.activePubkey);
  const key = attachmentDownloadTaskKey(accountPubkey, meta);
  const [result, setResult] = useState<{ key: string; uri: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    let current: DownloadTask | null = null;
    const unsubscribe = subscribeAttachmentDownload(key, (task) => {
      current = task;
      void task.promise.then((uri) => {
        if (!cancelled && current === task && !task.controller.signal.aborted) setResult({ key, uri });
      }, () => {});
    });
    return () => { cancelled = true; unsubscribe(); };
  }, [key]);
  return result?.key === key ? result.uri : null;
}
