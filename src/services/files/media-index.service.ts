import { db } from '@/db/client';
import { attachmentUrls, messageMedia, type MessageMediaKind } from '@/db/schema';
import type { Rumor } from '@/db/schema/types';
import type { EmbeddedMedia } from '@/lib/nostr/embedded-media';
import { embeddedMediaByUrl } from '@/lib/nostr/embedded-media';
import { findFileMeta } from '@/lib/nostr/file-tags';
import { messageOrderAt } from '@/lib/nostr/message-order';
import { parseMessageSegments } from '@/lib/text/message-segments';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function kindFromMime(mime?: string): MessageMediaKind {
  const normalized = mime?.trim().toLowerCase();
  if (normalized?.startsWith('image/')) return 'image';
  if (normalized?.startsWith('video/')) return 'video';
  if (normalized?.startsWith('audio/')) return 'audio';
  return 'file';
}

/** Record one kind-15 message reference and any signed URL-to-ox mapping. */
export async function recordAttachmentMedia(
  tx: Tx,
  rumor: Rumor,
  accountPubkey: string,
  conversationKey: string,
): Promise<void> {
  const meta = findFileMeta(rumor.content, rumor.tags);
  if (!meta || !rumor.id) return;
  const mediaKind = kindFromMime(meta.mime);
  await tx
    .insert(messageMedia)
    .values({
      accountPubkey,
      messageId: rumor.id,
      conversationKey,
      url: meta.url,
      source: 'attachment',
      mediaKind,
      gallery: mediaKind === 'image' || mediaKind === 'video',
      createdAt: rumor.created_at,
      orderAt: messageOrderAt(rumor),
    })
    .onConflictDoUpdate({
      target: [messageMedia.accountPubkey, messageMedia.messageId, messageMedia.url],
      set: {
        source: 'attachment',
        mediaKind,
        gallery: mediaKind === 'image' || mediaKind === 'video',
      },
    })
    .run();
  if (meta.plainSha256Hex) {
    await tx
      .insert(attachmentUrls)
      .values({ url: meta.url, ox: meta.plainSha256Hex })
      .onConflictDoUpdate({
        target: attachmentUrls.url,
        set: { ox: meta.plainSha256Hex },
      })
      .run();
  }
}

/** Index direct URL media without adding it to the app-owned attachment store. */
export async function recordEmbeddedMedia(
  tx: Tx,
  rumor: Rumor,
  accountPubkey: string,
  conversationKey: string,
): Promise<void> {
  if (!rumor.id || !/(?:https?:\/\/|www\.)/i.test(rumor.content)) return;
  const urls = parseMessageSegments(rumor.content).flatMap((segment) =>
    segment.type === 'url' ? [segment.href] : [],
  );
  const media = embeddedMediaByUrl(urls, rumor.tags);
  if (media.size === 0) return;
  await tx
    .insert(messageMedia)
    .values(
      [...media.values()].map((item) => ({
        accountPubkey,
        messageId: rumor.id!,
        conversationKey,
        url: item.url,
        source: 'embedded' as const,
        mediaKind: item.kind,
        gallery: item.kind === 'image' || item.kind === 'video',
        createdAt: rumor.created_at,
        orderAt: messageOrderAt(rumor),
      })),
    )
    .onConflictDoNothing()
    .run();
}

type EmbeddedMediaIndexInput = {
  accountPubkey: string;
  messageId: string;
  conversationKey: string;
  createdAt: number;
  orderAt: number;
  media: EmbeddedMedia;
};

// Old databases can contain messages from before direct-media indexing. Repair
// visible rows after paint, with bounded session bookkeeping.
const repairedThisSession = new Set<string>();
const REPAIR_CACHE_LIMIT = 2_048;
const repairInFlight = new Map<string, Promise<void>>();

export function ensureEmbeddedMediaIndexed(input: EmbeddedMediaIndexInput): Promise<void> {
  const key = `${input.accountPubkey}\u0000${input.messageId}\u0000${input.media.url}`;
  if (repairedThisSession.has(key)) return Promise.resolve();
  const current = repairInFlight.get(key);
  if (current) return current;

  const mediaKind = input.media.kind;
  const promise = db
    .insert(messageMedia)
    .values({
      accountPubkey: input.accountPubkey,
      messageId: input.messageId,
      conversationKey: input.conversationKey,
      url: input.media.url,
      source: 'embedded',
      mediaKind,
      gallery: mediaKind === 'image' || mediaKind === 'video',
      createdAt: input.createdAt,
      orderAt: input.orderAt,
    })
    .onConflictDoUpdate({
      target: [messageMedia.accountPubkey, messageMedia.messageId, messageMedia.url],
      set: {
        source: 'embedded',
        mediaKind,
        gallery: mediaKind === 'image' || mediaKind === 'video',
      },
    })
    .then(() => {
      repairedThisSession.add(key);
      if (repairedThisSession.size > REPAIR_CACHE_LIMIT) {
        const oldest = repairedThisSession.values().next().value;
        if (oldest) repairedThisSession.delete(oldest);
      }
    })
    .finally(() => repairInFlight.delete(key));
  repairInFlight.set(key, promise);
  return promise;
}
