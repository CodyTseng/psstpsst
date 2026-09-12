import {
  isValidEmojiShortcode,
  isValidEmojiUrl,
  parseEmojiSetCoordinate,
  type CustomEmoji,
} from './custom-emoji';

export type QuickReaction = string | CustomEmoji;

/** Stable identity shared by persistence, drag slots, and the reaction pill.
 * A custom reaction aggregates by shortcode + URL; its optional pack address
 * is publication metadata and does not create a second visible reaction. */
export function quickReactionKey(reaction: QuickReaction): string {
  return typeof reaction === 'string'
    ? JSON.stringify(['unicode', reaction])
    : JSON.stringify(['custom', reaction.shortcode.toLowerCase(), reaction.url]);
}

export function quickReactionLabel(reaction: QuickReaction): string {
  return typeof reaction === 'string' ? reaction : `:${reaction.shortcode}:`;
}

function parseQuickReaction(value: unknown): QuickReaction | null {
  if (typeof value === 'string') return value.length > 0 ? value : null;
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.shortcode !== 'string' ||
    typeof candidate.url !== 'string' ||
    !isValidEmojiShortcode(candidate.shortcode) ||
    !isValidEmojiUrl(candidate.url)
  ) {
    return null;
  }
  const setAddress = candidate.setAddress;
  if (
    setAddress !== undefined &&
    (typeof setAddress !== 'string' || !parseEmojiSetCoordinate(setAddress))
  ) {
    return null;
  }
  return {
    shortcode: candidate.shortcode,
    url: candidate.url,
    ...(typeof setAddress === 'string' ? { setAddress } : {}),
  };
}

/** Accepts the legacy string array and the current mixed string/object format. */
export function normalizeStoredQuickReactions(
  value: unknown,
): QuickReaction[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const parsed = value.map(parseQuickReaction);
  return parsed.every((reaction): reaction is QuickReaction => reaction !== null)
    ? parsed
    : null;
}
