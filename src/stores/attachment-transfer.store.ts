import { useStore } from 'zustand';

import {
  attachmentTransferKey,
  attachmentDownloadKey,
  attachmentTransferStore,
  type AttachmentTransferProgress,
} from '@/services/files/attachment-transfer-state';

/** Download bubbles share a URL subscription; pending uploads use their message key. */
export function useAttachmentTransfer(
  accountPubkey: string | null,
  rumorId?: string,
  url?: string,
): AttachmentTransferProgress | null {
  const key = url
    ? attachmentDownloadKey(accountPubkey, url)
    : accountPubkey && rumorId ? attachmentTransferKey(accountPubkey, rumorId) : '';
  return useStore(attachmentTransferStore, (state) => state.byKey[key] ?? null);
}
