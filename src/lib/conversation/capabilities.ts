import { fileMime } from '@/lib/nostr/file-tags';
import { embeddedMediaByUrl } from '@/lib/nostr/embedded-media';
import type { IncomingShareItem } from '@/lib/share/incoming-share';
import { parseMessageSegments } from '@/lib/text/message-segments';

export type ConversationDeliveryKind = 'relay' | 'proximity';

/** Content features available in every conversation transport. */
export type ConversationContentCapability =
  | 'text'
  | 'custom-emoji'
  | 'image'
  | 'video'
  | 'audio'
  | 'file'
  | 'payment-request';

type ConversationMessage = {
  kind: number;
  content?: string;
  tags: string[][];
};

const CONVERSATION_CAPABILITIES: ReadonlySet<ConversationContentCapability> = new Set([
  'text',
  'custom-emoji',
  'image',
  'video',
  'audio',
  'file',
  'payment-request',
]);

/** Single source of truth for content every conversation can send. */
export function conversationSupportsContent(
  capability: ConversationContentCapability,
): boolean {
  return CONVERSATION_CAPABILITIES.has(capability);
}

/** Classify a file MIME type into the transport capability needed to send it. */
export function fileContentCapability(mime?: string): ConversationContentCapability {
  if (mime?.startsWith('image/')) return 'image';
  if (mime?.startsWith('video/')) return 'video';
  if (mime?.startsWith('audio/')) return 'audio';
  return 'file';
}

/** Whether a stored/forwarded NIP-17 message uses a supported content feature. */
export function conversationSupportsMessage(
  message: ConversationMessage,
): boolean {
  if (message.kind === 15) {
    return conversationSupportsContent(fileContentCapability(fileMime(message.tags)));
  }
  if (message.kind !== 14) return false;
  if (!conversationSupportsContent('text')) return false;
  if (
    message.tags.some((tag) => tag[0] === 'emoji') &&
    !conversationSupportsContent('custom-emoji')
  ) {
    return false;
  }
  const urls = parseMessageSegments(message.content ?? '')
    .filter((segment) => segment.type === 'url')
    .map((segment) => segment.href);
  for (const media of embeddedMediaByUrl(urls, message.tags).values()) {
    if (!conversationSupportsContent(media.kind)) return false;
  }
  return true;
}

/** Whether one normalized operating-system share item is supported. */
export function conversationSupportsIncomingShareItem(
  item: IncomingShareItem,
): boolean {
  return item.kind === 'text'
    ? conversationSupportsMessage({ kind: 14, content: item.content, tags: [] })
    : conversationSupportsContent(fileContentCapability(item.mime));
}

/** Attachment tray sources exposed by the shared feature set and account state. */
export function conversationAttachmentSources(
  paymentRequestAvailable: boolean,
): ('invoice' | 'camera' | 'library' | 'file' | 'card')[] {
  const sources: ('invoice' | 'camera' | 'library' | 'file' | 'card')[] = [];
  if (
    paymentRequestAvailable &&
    conversationSupportsContent('payment-request')
  ) {
    sources.push('invoice');
  }
  if (
    conversationSupportsContent('image') ||
    conversationSupportsContent('video')
  ) {
    sources.push('camera', 'library');
  }
  if (conversationSupportsContent('file')) sources.push('file');
  // A contact card is plain kind-14 text — available wherever text is.
  if (conversationSupportsContent('text')) sources.push('card');
  return sources;
}
