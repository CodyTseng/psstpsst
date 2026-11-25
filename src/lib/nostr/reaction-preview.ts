import type { TFunction } from 'i18next';

import { shortEmojiMessage } from '@/lib/emoji/short-message';
import { customEmojisFromMessageTags } from '@/lib/nostr/custom-emoji';

export type ReactionPreview = { emoji: string | null };

/** A null emoji represents a valid custom reaction without an inline image. */
export function parseReactionPreview(content: string, tags: string[][]): ReactionPreview | null {
  const raw = content.trim();
  if (raw === '' || raw === '+') return { emoji: '👍' };
  if (raw === '-') return { emoji: '👎' };
  if (raw.startsWith(':')) {
    return customEmojisFromMessageTags(tags).some(({ shortcode }) => raw === `:${shortcode}:`)
      ? { emoji: null }
      : null;
  }
  const emoji = shortEmojiMessage(raw) ?? shortEmojiMessage(`${raw}\uFE0F`);
  return emoji?.count === 1 ? { emoji: emoji.emojis[0] } : null;
}

export function reactionPreviewText(t: TFunction, preview: ReactionPreview): string {
  return preview.emoji
    ? t('conversations.reaction_preview_emoji', { emoji: preview.emoji })
    : t('conversations.reaction_preview');
}
