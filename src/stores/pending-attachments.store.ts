import { useLayoutEffect } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import { pendingAttachmentsStore, retainPendingAttachmentPresentation, type PendingAttachmentsState, type PendingAttachment } from '@/services/files/pending-attachments';

export { newTempId, PENDING_UPLOAD_INTERRUPTED } from '@/services/files/pending-attachments';
export type { PendingAttachment, PendingAttachmentStatus } from '@/services/files/pending-attachments';

/** React binding over the service-owned, durable pending-attachment state. */
export const usePendingAttachmentsStore = Object.assign(
  function usePendingAttachmentsStore<T>(selector: (state: PendingAttachmentsState) => T): T {
    return useStore(pendingAttachmentsStore, selector);
  },
  pendingAttachmentsStore,
);

export function useInFlightAttachmentsFor(
  accountPubkey: string,
  conversationKey: string,
): PendingAttachment[] {
  useLayoutEffect(() => retainPendingAttachmentPresentation(accountPubkey, conversationKey), [accountPubkey, conversationKey]);
  return usePendingAttachmentsStore(useShallow((state) => state.items.filter(
    (item) => item.accountPubkey === accountPubkey && item.conversationKey === conversationKey,
  )));
}
