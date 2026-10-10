import { DEFAULT_IMAGE_SEND_QUALITY } from '@/lib/attachments/image-quality';
import type { IncomingShareItem } from '@/lib/share/incoming-share';
import { shareTargetId, type ShareTarget } from '@/lib/share/share-target';
import { nextRumorTimestamp } from '@/services/dm/rumor-clock';
import { attachmentTransferKey, attachmentTransferStore } from '@/services/files/attachment-transfer-state';
import { pendingAttachmentSendService, UPLOAD_PREPARING_PERCENT, type PendingAttachmentTarget } from '@/services/files/pending-attachment-send.service';
import { newTempId, pendingAttachmentsStore } from '@/services/files/pending-attachments';
import { proximityService } from '@/services/proximity/proximity.service';

import { conversationSendService } from './conversation-send.service';

/** Enqueue every file before navigation; all bytes already belong to the app. */
export function prepareIncomingShareSend(
  accountPubkey: string,
  targets: ShareTarget[],
  items: IncomingShareItem[],
  onLocalFileReady?: (file: { uri: string; mime: string }) => Promise<void>,
) {
  const uniqueTargets = [...new Map(targets.map((target) => [shareTargetId(target), target])).values()];
  const jobs = items.map((item) => {
    const timestamp = nextRumorTimestamp();
    const controller = new AbortController();
    const entries: PendingAttachmentTarget[] = item.kind === 'text' ? [] : uniqueTargets.map((target) => ({
      target,
      item: {
        tempId: newTempId(), accountPubkey, conversationKey: target.conversationKey,
        localUri: item.localUri, mime: item.mime, name: item.name, size: item.size,
        width: item.width, height: item.height,
        imageQuality: item.mime.startsWith('image/') ? DEFAULT_IMAGE_SEND_QUALITY : undefined,
        status: 'preparing', startedAt: timestamp.createdAt, messageOrderAt: timestamp.orderAt,
      },
    }));
    return { item, timestamp, entries, controller };
  });
  const pending = jobs.flatMap((job) => job.entries.map((entry) => entry.item));
  for (const job of jobs) for (const { item } of job.entries) {
    pendingAttachmentSendService.controllers.set(item.tempId, job.controller);
    attachmentTransferStore.getState().update(
      attachmentTransferKey(accountPubkey, item.tempId), 'upload', UPLOAD_PREPARING_PERCENT, 100,
    );
  }
  // enqueue publishes preparing rows synchronously, before its first async copy.
  const staging = pendingAttachmentsStore.getState().enqueue(pending);
  const stagedIndex = staging.then((items) => new Map(items.map((item) => [item.tempId, item])));
  for (const item of pending) {
    const ready = stagedIndex.then((index) => index.get(item.tempId) ?? null);
    pendingAttachmentSendService.staging.set(item.tempId, ready);
    void ready.finally(() => {
      if (pendingAttachmentSendService.staging.get(item.tempId) === ready) {
        pendingAttachmentSendService.staging.delete(item.tempId);
      }
    });
  }

  return {
    async run(): Promise<boolean> {
      let failed = false;
      const stagedById = await stagedIndex;
      for (const job of jobs) {
        if (job.item.kind === 'text') {
          for (const target of uniqueTargets) {
            try {
              await conversationSendService.sendMessage({
                accountPubkey, target, content: job.item.content, timestamp: job.timestamp,
              });
            } catch { failed = true; }
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
          }
        } else {
          const entries = job.entries.flatMap((entry): PendingAttachmentTarget[] => {
            const item = stagedById.get(entry.item.tempId);
            return item ? [{ ...entry, item }] : [];
          });
          failed = await pendingAttachmentSendService.upload(entries, job.controller, {
            // This cache copy stays alive for the whole shared attempt, even if
            // one target's persistent pending source is discarded from the chat.
            sourceUri: job.item.localUri,
            onLocalFileReady,
            onSent: (target) => {
              if (target.deliveryKind === 'proximity') {
                void proximityService.recoverConnection(accountPubkey, target.conversationKey).catch(() => {});
              }
            },
          }) || failed;
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      }
      return failed;
    },

    /** Preserve retry bytes if staging fell back to the app-owned cache URI. */
    releaseSource(cleanup: () => Promise<void>): void {
      const ids = new Set(pending.map((item) => item.tempId));
      const safeToRelease = () => !pendingAttachmentsStore.getState().items.some((item) =>
        ids.has(item.tempId) && item.status !== 'sent' && !item.localName,
      );
      if (safeToRelease()) { void cleanup(); return; }
      const unsubscribe = pendingAttachmentsStore.subscribe(() => {
        if (!safeToRelease()) return;
        unsubscribe();
        void cleanup();
      });
    },
  };
}
