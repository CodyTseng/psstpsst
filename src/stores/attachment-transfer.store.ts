import { useStore } from 'zustand';

import {
  attachmentTransferKey,
  attachmentTransferStore,
  type AttachmentTransferProgress,
} from '@/services/files/attachment-transfer-state';

/** Subscribe one attachment bubble to only its own active transfer. */
export function useAttachmentTransfer(
  accountPubkey: string | null,
  rumorId?: string,
): AttachmentTransferProgress | null {
  const key = accountPubkey && rumorId ? attachmentTransferKey(accountPubkey, rumorId) : '';
  return useStore(attachmentTransferStore, (state) => state.byKey[key] ?? null);
}
