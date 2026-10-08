type PendingAttachmentIdentity = {
  tempId: string;
  status: string;
  sentRumorId?: string;
};

/** A displayed sent message can release its placeholder only after content actions finish. */
export function reconcileRenderedPendingAttachments(
  pending: readonly PendingAttachmentIdentity[],
  renderedMessageIds: ReadonlySet<string>,
  retainedTempIds: ReadonlySet<string>,
  remove: (tempId: string) => void,
): void {
  for (const item of pending) {
    if (item.status === 'sent' && item.sentRumorId &&
        renderedMessageIds.has(item.sentRumorId) && !retainedTempIds.has(item.tempId)) {
      remove(item.tempId);
    }
  }
}
