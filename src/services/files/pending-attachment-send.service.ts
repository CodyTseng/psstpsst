import { isAbortError, throwIfAborted } from '@/lib/async/abort';
import type { ConversationTarget } from '@/lib/conversation/target';
import { shareTargetId } from '@/lib/share/share-target';
import { buildSigner } from '@/services/account/account.service';
import { conversationSendService } from '@/services/conversation/conversation-send.service';
import { rumorTimestampFromOrderAt } from '@/services/dm/rumor-clock';

import { attachmentTransferKey, attachmentTransferStore } from './attachment-transfer-state';
import type { UploadAttachmentResult } from './file-attachment.service';
import { nearbyFileUploadService } from './nearby-file-upload.service';
import { pendingAttachmentsStore, type PendingAttachment } from './pending-attachments';

export const UPLOAD_PREPARING_PERCENT = 5;
const UPLOAD_ENCRYPTING_PERCENT = 15;
const UPLOAD_BYTES_START_PERCENT = 20;
// Reserve 100% for the pending-to-stored handoff instead of flashing a final overlay.
const UPLOAD_BYTES_END_PERCENT = 99;

function uploadByteProgress(sentBytes: number, totalBytes: number): number {
  if (totalBytes <= 0) return UPLOAD_BYTES_START_PERCENT;
  const fraction = Math.max(0, Math.min(1, sentBytes / totalBytes));
  return Math.floor(UPLOAD_BYTES_START_PERCENT + fraction * (UPLOAD_BYTES_END_PERCENT - UPLOAD_BYTES_START_PERCENT));
}

export type PendingAttachmentTarget = { item: PendingAttachment; target: ConversationTarget };
type Options = {
  sourceUri?: string;
  subject?: string;
  onLocalFileReady?: (file: { uri: string; mime: string }) => Promise<void>;
  onSent?: (target: ConversationTarget) => void;
  onFailed?: () => void;
};

/** Shared attempts make chat controls work for uploads started outside the chat. */
export const pendingAttachmentSendService = {
  controllers: new Map<string, AbortController>(),
  // All recipients hold a lease on a Nearby-staged blob, including relay users.
  nearbyUploadKeys: new Map<string, string>(),
  committedUploadKeys: new Set<string>(),
  preparedFiles: new Map<string, UploadAttachmentResult>(),
  staging: new Map<string, Promise<PendingAttachment | null>>(),

  detachAttempt(tempId: string): void {
    const controller = this.controllers.get(tempId);
    if (!controller) return;
    const shared = [...this.controllers].some(([id, attempt]) => id !== tempId && attempt === controller);
    if (shared) this.controllers.delete(tempId);
    else controller.abort();
  },

  async releaseNearbyUploadKey(accountPubkey: string, tempId: string): Promise<void> {
    const key = this.nearbyUploadKeys.get(tempId);
    if (!key) return;
    this.nearbyUploadKeys.delete(tempId);
    if (![...this.nearbyUploadKeys.values()].includes(key)) {
      const committedKey = `${accountPubkey}:${key}`;
      if (!this.committedUploadKeys.has(committedKey)) {
        await nearbyFileUploadService.discard(accountPubkey, key).catch(() => {});
      }
      this.committedUploadKeys.delete(committedKey);
    }
  },

  pause(tempId: string): void {
    const item = pendingAttachmentsStore.getState().items.find((candidate) => candidate.tempId === tempId);
    if (!item || !['preparing', 'encrypting', 'uploading'].includes(item.status)) return;
    pendingAttachmentsStore.getState().markPaused(tempId);
    this.detachAttempt(tempId);
    attachmentTransferStore.getState().clear(attachmentTransferKey(item.accountPubkey, tempId));
    const key = this.nearbyUploadKeys.get(tempId);
    if (key && !this.committedUploadKeys.has(`${item.accountPubkey}:${key}`) && ![...this.nearbyUploadKeys].some(([id, value]) =>
      id !== tempId && value === key && this.controllers.has(id),
    )) void nearbyFileUploadService.pause(item.accountPubkey, key);
  },

  cancel(tempId: string): void {
    const item = pendingAttachmentsStore.getState().items.find((candidate) => candidate.tempId === tempId);
    if (!item) return;
    this.detachAttempt(tempId);
    this.preparedFiles.delete(tempId);
    attachmentTransferStore.getState().clear(attachmentTransferKey(item.accountPubkey, tempId));
    void this.releaseNearbyUploadKey(item.accountPubkey, tempId);
    pendingAttachmentsStore.getState().removeOne(tempId);
  },

  async prepareRetry(accountPubkey: string, tempId: string): Promise<void> {
    const key = this.nearbyUploadKeys.get(tempId);
    if (key && this.preparedFiles.has(tempId)) {
      await nearbyFileUploadService.resume(accountPubkey, key);
    } else {
      await this.releaseNearbyUploadKey(accountPubkey, tempId);
    }
  },

  /** Upload one file once and correlate its pending bubbles across all targets. */
  async upload(entries: PendingAttachmentTarget[], controller: AbortController, options: Options = {}): Promise<boolean> {
    const first = entries[0]?.item;
    if (!first) return false;
    const accountPubkey = first.accountPubkey;
    const entryIds = new Set(entries.map((entry) => entry.item.tempId));
    let observedItems: PendingAttachment[] | undefined;
    const currentById = new Map<string, PendingAttachment>();
    const current = (item: PendingAttachment) => {
      if (this.controllers.get(item.tempId) !== controller) return undefined;
      const items = pendingAttachmentsStore.getState().items;
      if (items !== observedItems) {
        observedItems = items;
        currentById.clear();
        for (const candidate of items) {
          if (candidate.accountPubkey === accountPubkey && entryIds.has(candidate.tempId)) {
            currentById.set(candidate.tempId, candidate);
          }
        }
      }
      return currentById.get(item.tempId);
    };
    const pending = () => entries.filter(({ item }) => {
      const value = current(item);
      return value && value.status !== 'sent';
    });
    const store = pendingAttachmentsStore.getState();
    let localFile: { uri: string; mime: string } | undefined;
    let preparedFile = this.preparedFiles.get(first.tempId);
    const retained = () => pendingAttachmentsStore.getState().items.filter((item) => {
      const owner = this.controllers.get(item.tempId);
      return item.accountPubkey === accountPubkey && entryIds.has(item.tempId)
        && (!owner || owner === controller) && item.status !== 'sent';
    });
    try {
      throwIfAborted(controller.signal);
      const active = pending();
      if (!active.length) return false;
      const signer = await buildSigner(accountPubkey);
      throwIfAborted(controller.signal);
      const byTarget = new Map(active.map((entry) => [shareTargetId(entry.target), entry.item]));
      await conversationSendService.sendFile({
        accountPubkey,
        signer,
        targets: active.map((entry) => entry.target),
        preparedFile,
        onFileReady: (file) => {
          preparedFile = file;
          for (const item of retained()) this.preparedFiles.set(item.tempId, file);
        },
        localUri: options.sourceUri ?? first.localUri,
        mime: first.mime,
        name: first.name,
        dim: first.width && first.height ? `${first.width}x${first.height}` : undefined,
        durationSec: first.durationSec,
        waveform: first.waveform,
        imageQuality: first.imageQuality,
        timestamp: first.messageOrderAt == null ? undefined : rumorTimestampFromOrderAt(first.messageOrderAt),
        replyToId: first.replyToId,
        subject: options.subject,
        onStep: (step) => {
          if (controller.signal.aborted || step === 'publishing') return;
          const percent = step === 'encrypting' ? UPLOAD_ENCRYPTING_PERCENT
            : step === 'uploading' ? UPLOAD_BYTES_START_PERCENT : null;
          for (const { item } of pending()) {
            if (percent !== null) attachmentTransferStore.getState().update(
              attachmentTransferKey(accountPubkey, item.tempId), 'upload', percent, 100,
            );
            store.setStatus(item.tempId, step);
          }
        },
        onUploadProgress: (sentBytes, totalBytes) => {
          for (const { item } of pending()) attachmentTransferStore.getState().update(
            attachmentTransferKey(accountPubkey, item.tempId), 'upload', uploadByteProgress(sentBytes, totalBytes), 100,
          );
        },
        onMediaDimensions: (dimensions) => {
          if (controller.signal.aborted) return;
          for (const { item } of pending()) store.setDimensions(item.tempId, dimensions);
        },
        onUploadPrepared: ({ cipherSha256Hex }) => {
          // Ordinary relay uploads have no Nearby background job to control.
          if (!preparedFile?.url.startsWith('blossom:')) return;
          const consumers = retained();
          for (const item of consumers) this.nearbyUploadKeys.set(item.tempId, cipherSha256Hex);
          const committed = this.committedUploadKeys.has(`${accountPubkey}:${cipherSha256Hex}`);
          if (committed) return;
          if (!consumers.length) {
            void nearbyFileUploadService.discard(accountPubkey, cipherSha256Hex);
          } else if (!consumers.some((item) => item.status !== 'paused' && this.controllers.get(item.tempId) === controller)) {
            void nearbyFileUploadService.pause(accountPubkey, cipherSha256Hex);
          }
        },
        onLocalFileReady: async (file) => {
          localFile = file;
          await options.onLocalFileReady?.(file);
        },
        onUploadReady: ({ url }) => {
          for (const { item } of pending()) store.markUploaded(item.tempId, url);
        },
        shouldSendTarget: (target) => {
          const item = byTarget.get(shareTargetId(target));
          return !!item && !!current(item) && current(item)?.status !== 'paused';
        },
        onTargetPublishing: (target) => {
          const item = byTarget.get(shareTargetId(target));
          const value = item && current(item);
          if (value && value.status !== 'paused') store.setStatus(value.tempId, 'publishing');
        },
        onTargetStored: (target, rumorId) => {
          const item = byTarget.get(shareTargetId(target));
          if (item && current(item)) {
            const key = this.nearbyUploadKeys.get(item.tempId);
            if (key) this.committedUploadKeys.add(`${accountPubkey}:${key}`);
            store.markSent(item.tempId, rumorId, localFile);
            this.preparedFiles.delete(item.tempId);
            this.nearbyUploadKeys.delete(item.tempId);
            if (key && ![...this.nearbyUploadKeys.values()].includes(key)) {
              this.committedUploadKeys.delete(`${accountPubkey}:${key}`);
            }
            options.onSent?.(target);
          }
        },
        signal: controller.signal,
      });
      return false;
    } catch (error) {
      if (isAbortError(error)) {
        for (const { item } of pending()) {
          if (current(item)?.status !== 'paused') store.markPaused(item.tempId);
        }
        return false;
      }
      const failures = pending();
      if (!failures.length) return false;
      for (const { item } of failures) store.markFailed(
        item.tempId, error instanceof Error ? error.message : String(error),
      );
      options.onFailed?.();
      return true;
    } finally {
      for (const { item } of entries) {
        if (this.controllers.get(item.tempId) === controller) {
          attachmentTransferStore.getState().clear(attachmentTransferKey(accountPubkey, item.tempId));
          this.controllers.delete(item.tempId);
        }
      }
    }
  },
};
