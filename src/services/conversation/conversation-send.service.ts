import type { CustomEmoji } from '@/lib/nostr/custom-emoji';
import type { ImageSendQuality } from '@/lib/attachments/image-quality';
import type { ConversationDeliveryKind } from '@/lib/conversation/capabilities';
import { throwIfAborted } from '@/lib/async/abort';

import { dmService } from '../dm/dm.service';
import type { RumorTimestamp } from '../dm/rumor-clock';
import { markDownloaded } from '../files/attachment-index.service';
import { stageNearbyAttachment, uploadAttachment } from '../files/file-attachment.service';
import { loadAccountMediaServers } from '../files/media-server.service';
import {
  ensureNearbyFileRemotelyAvailable,
  nearbyFileUploadService,
} from '../files/nearby-file-upload.service';
import { proximityService } from '../proximity/proximity.service';
import type { Signer } from '../signer/signer.interface';
import { parseNearbyFileOffer } from '../proximity/proximity-file-offer';

export type ConversationSendTarget = {
  deliveryKind: ConversationDeliveryKind;
  conversationKey: string;
};

type SendMessageOptions = {
  accountPubkey: string;
  target: ConversationSendTarget;
  content: string;
  extraTags?: string[][];
  replyToId?: string;
  subject?: string;
  timestamp?: RumorTimestamp;
};

type SendReactionOptions = {
  accountPubkey: string;
  target: ConversationSendTarget;
  targetMessageId: string;
  emoji: string | CustomEmoji;
};

type ForwardMessageOptions = {
  accountPubkey: string;
  target: ConversationSendTarget;
  kind: number;
  content: string;
  contentTags: string[][];
  timestamp?: RumorTimestamp;
};

type SendFileOptions = {
  accountPubkey: string;
  signer: Signer;
  targets: ConversationSendTarget[];
  localUri: string;
  mime?: string;
  name?: string;
  dim?: string;
  durationSec?: number;
  waveform?: number[];
  imageQuality?: ImageSendQuality;
  replyToId?: string;
  subject?: string;
  timestamp?: RumorTimestamp;
  onStep?: (step: 'encrypting' | 'uploading' | 'publishing') => void;
  onUploadProgress?: (sentBytes: number, totalBytes: number) => void;
  /** Announces the encrypted transfer identity as soon as durable staging is ready. */
  onUploadPrepared?: (file: { cipherSha256Hex: string }) => void;
  /** Best-effort display-cache warmup after the permanent local mirror exists,
   * but before the stored message can replace its pending bubble. */
  onLocalFileReady?: (file: { uri: string; mime: string }) => Promise<void>;
  /** Announces the final blob URL before any target stores its rumor, allowing
   * an optimistic row to correlate with the live DB row atomically. */
  onUploadReady?: (file: { url: string }) => void;
  signal?: AbortSignal;
};

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Feature-level message sender shared by relay and Nearby conversations.
 * Transport services only own delivery; the authored NIP-17 payload is the same.
 */
class ConversationSendService {
  async sendMessage(opts: SendMessageOptions): Promise<{ rumorId: string }> {
    if (opts.target.deliveryKind === 'proximity') {
      const rumor = await proximityService.sendMessage({
        accountPubkey: opts.accountPubkey,
        peerPubkey: opts.target.conversationKey,
        content: opts.content,
        extraTags: opts.extraTags,
        replyToId: opts.replyToId,
        subject: opts.subject,
        timestamp: opts.timestamp,
      });
      return { rumorId: rumor.id! };
    }
    return dmService.sendMessage({
      accountPubkey: opts.accountPubkey,
      recipientPubkeys: [opts.target.conversationKey],
      content: opts.content,
      extraTags: opts.extraTags,
      replyToId: opts.replyToId,
      subject: opts.subject,
      timestamp: opts.timestamp,
    });
  }

  async sendReaction(opts: SendReactionOptions): Promise<{ rumorId: string }> {
    if (opts.target.deliveryKind === 'proximity') {
      const rumor = await proximityService.sendReaction({
        accountPubkey: opts.accountPubkey,
        peerPubkey: opts.target.conversationKey,
        targetMessageId: opts.targetMessageId,
        emoji: opts.emoji,
      });
      return { rumorId: rumor.id! };
    }
    return dmService.sendReaction({
      accountPubkey: opts.accountPubkey,
      recipientPubkeys: [opts.target.conversationKey],
      targetMessageId: opts.targetMessageId,
      emoji: opts.emoji,
    });
  }

  async forwardMessage(opts: ForwardMessageOptions): Promise<{ rumorId: string }> {
    if (opts.kind === 15) {
      const offer = parseNearbyFileOffer(opts.content, opts.contentTags);
      if (offer) {
        await ensureNearbyFileRemotelyAvailable(
          opts.accountPubkey,
          offer,
          undefined,
          opts.target.deliveryKind === 'relay',
        );
      }
    }
    if (opts.target.deliveryKind === 'proximity') {
      const rumor = await proximityService.forwardMessage({
        accountPubkey: opts.accountPubkey,
        peerPubkey: opts.target.conversationKey,
        kind: opts.kind,
        content: opts.content,
        contentTags: opts.contentTags,
        timestamp: opts.timestamp,
      });
      return { rumorId: rumor.id! };
    }
    return dmService.forwardMessage({
      accountPubkey: opts.accountPubkey,
      recipientPubkeys: [opts.target.conversationKey],
      kind: opts.kind,
      content: opts.content,
      contentTags: opts.contentTags,
      timestamp: opts.timestamp,
    });
  }

  /** Upload once, then reference the same encrypted blob from every transport. */
  async sendFile(opts: SendFileOptions): Promise<{ rumorIds: string[] }> {
    throwIfAborted(opts.signal);
    const uniqueTargets = new Map(
      opts.targets.map((target) => [`${target.deliveryKind}:${target.conversationKey}`, target]),
    );
    let firstError: unknown;
    for (const [key, target] of uniqueTargets) {
      if (target.deliveryKind !== 'proximity') continue;
      try {
        await proximityService.assertConversationWritable(
          opts.accountPubkey,
          target.conversationKey,
        );
      } catch (error) {
        firstError ??= error;
        uniqueTargets.delete(key);
      }
    }
    if (uniqueTargets.size === 0 && firstError) throw firstError;
    const servers = await loadAccountMediaServers(opts.accountPubkey);
    const hasProximityTarget = Array.from(uniqueTargets.values()).some(
      (target) => target.deliveryKind === 'proximity',
    );
    const attachmentInput = {
      localUri: opts.localUri,
      mime: opts.mime,
      name: opts.name,
      dim: opts.dim,
      durationSec: opts.durationSec,
      waveform: opts.waveform,
      imageQuality: opts.imageQuality,
      servers,
      onStep: (step: 'encrypting' | 'uploading') => opts.onStep?.(step),
      onUploadProgress: opts.onUploadProgress,
      signal: opts.signal,
    };
    const uploaded = hasProximityTarget
      ? await stageNearbyAttachment({
          ...attachmentInput,
          accountPubkey: opts.accountPubkey,
        })
      : await uploadAttachment({ ...attachmentInput, signer: opts.signer });
    opts.onUploadPrepared?.({ cipherSha256Hex: uploaded.meta.cipherSha256Hex });
    throwIfAborted(opts.signal);
    let remoteAvailable = !hasProximityTarget;
    if (hasProximityTarget) {
      opts.onStep?.('uploading');
      remoteAvailable = await nearbyFileUploadService.preferUntilAvailable(
        opts.accountPubkey,
        uploaded.meta.cipherSha256Hex,
        opts.signal,
        opts.onUploadProgress,
      );
      throwIfAborted(opts.signal);
      // When unavailable, the durable upload job keeps retrying; publish the
      // Nearby rumor so the authenticated peer can fall back to BLE meanwhile.
    }
    if (uploaded.localUri && opts.onLocalFileReady) {
      await opts
        .onLocalFileReady({
          uri: uploaded.localUri,
          mime: uploaded.meta.mime ?? 'application/octet-stream',
        })
        .catch(() => {});
    }
    throwIfAborted(opts.signal);
    try {
      opts.onUploadReady?.({ url: uploaded.url });
    } catch {
      // UI correlation is best-effort and must never block message delivery.
    }
    throwIfAborted(opts.signal);
    // Cancellation closes here. From this callback onward, at least one
    // gift-wrapped event may be persisted and queued for delivery.
    opts.onStep?.('publishing');
    const contentTags = [
      ...uploaded.tags,
      ...(opts.replyToId ? [['e', opts.replyToId, '', 'reply']] : []),
      ...(opts.subject ? [['subject', opts.subject]] : []),
    ];
    const rumorIds: string[] = [];
    const orderedTargets = Array.from(uniqueTargets.values()).sort((a, b) =>
      a.deliveryKind === b.deliveryKind ? 0 : a.deliveryKind === 'proximity' ? -1 : 1,
    );
    for (const target of orderedTargets) {
      try {
        if (target.deliveryKind === 'relay' && !remoteAvailable) {
          opts.onStep?.('uploading');
          await nearbyFileUploadService.waitUntilAvailable(
            opts.accountPubkey,
            uploaded.meta.cipherSha256Hex,
            opts.signal,
          );
          remoteAvailable = true;
          opts.onStep?.('publishing');
        }
        const sent = await this.forwardMessage({
          accountPubkey: opts.accountPubkey,
          target,
          kind: 15,
          content: uploaded.url,
          contentTags,
          timestamp: opts.timestamp,
        });
        rumorIds.push(sent.rumorId);
      } catch (error) {
        firstError ??= error;
      }
      await yieldToUi();
    }
    if (rumorIds.length > 0 && uploaded.storedLocally && uploaded.meta.plainSha256Hex) {
      await markDownloaded(
        uploaded.url,
        uploaded.meta.plainSha256Hex,
        uploaded.meta.mime ?? 'application/octet-stream',
        uploaded.localSize,
      );
    }
    if (firstError) throw firstError;
    return { rumorIds };
  }
}

export const conversationSendService = new ConversationSendService();
