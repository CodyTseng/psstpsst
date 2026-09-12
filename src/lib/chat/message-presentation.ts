import { shortCustomEmojiMessage } from '@/lib/emoji/custom-message';
import { shortEmojiMessage } from '@/lib/emoji/short-message';
import { customEmojisFromMessageTags } from '@/lib/nostr/custom-emoji';
import { embeddedMediaByUrl, type EmbeddedMedia } from '@/lib/nostr/embedded-media';
import { findFileMeta } from '@/lib/nostr/file-tags';
import {
  parseMessageSegments,
  soleMentionPubkey,
  splitMessageContentBlocks,
  type MessageContentBlock,
  type MessageSegment,
} from '@/lib/text/message-segments';
import { invoiceMessageDescription, parseInvoiceMessage } from '@/lib/wallet/invoice-message';

export type PreparedMessagePresentation = {
  customEmojiMap: Map<
    string,
    ReturnType<typeof customEmojisFromMessageTags>[number]
  >;
  shortCustomEmojis: ReturnType<typeof shortCustomEmojiMessage>;
  shortEmoji: ReturnType<typeof shortEmojiMessage>;
  segments: MessageSegment[];
  embeddedMedia: Map<string, EmbeddedMedia>;
  contentBlocksWithMedia: MessageContentBlock[] | null;
  contentBlocksWithoutMedia: MessageContentBlock[] | null;
  cardPubkey: string | null;
  invoice: ReturnType<typeof parseInvoiceMessage>;
  invoiceDescription: string | null;
  attachment: ReturnType<typeof findFileMeta>;
};

type PrepareParams = {
  messageId?: string;
  kind: number;
  content: string;
  tags?: string[][] | null;
};

const MAX_PREPARED_MESSAGES = 2048;
const preparedByMessageId = new Map<string, PreparedMessagePresentation>();

function contentBlocks(
  segments: MessageSegment[],
  embeddedMedia: ReadonlyMap<string, EmbeddedMedia>,
): MessageContentBlock[] | null {
  if (!segments.some((segment) => segment.type === 'event') && embeddedMedia.size === 0) {
    return null;
  }
  return splitMessageContentBlocks(segments, new Set(embeddedMedia.keys()));
}

function buildPresentation({ kind, content, tags }: PrepareParams): PreparedMessagePresentation {
  const customEmojis = customEmojisFromMessageTags(tags);
  const customEmojiMap = new Map(
    customEmojis.map((emoji) => [emoji.shortcode.toLowerCase(), emoji] as const),
  );
  const shortCustomEmojis = shortCustomEmojiMessage(content, customEmojiMap);
  const shortEmoji = shortEmojiMessage(content);
  const shortEmojiContent = shortEmoji?.content ?? null;
  const segments = shortEmojiContent ? [] : parseMessageSegments(content);
  const embeddedMedia = embeddedMediaByUrl(
    segments.flatMap((segment) => (segment.type === 'url' ? [segment.href] : [])),
    tags ?? [],
  );

  return {
    customEmojiMap,
    shortCustomEmojis,
    shortEmoji,
    segments,
    embeddedMedia,
    contentBlocksWithMedia: contentBlocks(segments, embeddedMedia),
    contentBlocksWithoutMedia: contentBlocks(segments, new Map()),
    cardPubkey: shortEmojiContent ? null : soleMentionPubkey(content),
    invoice: shortEmojiContent ? null : parseInvoiceMessage(content),
    invoiceDescription: invoiceMessageDescription(tags),
    attachment: kind === 15 ? findFileMeta(content, tags ?? []) : null,
  };
}

/** Return an immutable, bounded presentation model. Inbox tail warming calls
 * this before navigation, so rich-message parsing is normally absent from the
 * destination render. Message ids are content hashes and therefore safe keys. */
export function prepareMessagePresentation(
  params: PrepareParams,
): PreparedMessagePresentation {
  if (!params.messageId) return buildPresentation(params);
  const cached = preparedByMessageId.get(params.messageId);
  if (cached) {
    preparedByMessageId.delete(params.messageId);
    preparedByMessageId.set(params.messageId, cached);
    return cached;
  }

  const prepared = buildPresentation(params);
  preparedByMessageId.set(params.messageId, prepared);
  if (preparedByMessageId.size > MAX_PREPARED_MESSAGES) {
    const oldest = preparedByMessageId.keys().next().value;
    if (oldest !== undefined) preparedByMessageId.delete(oldest);
  }
  return prepared;
}
