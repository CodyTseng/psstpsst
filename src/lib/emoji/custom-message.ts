import type { CustomEmoji } from '@/lib/nostr/custom-emoji';

export type CustomEmojiTextPart =
  | { type: 'text'; value: string }
  | { type: 'emoji'; emoji: CustomEmoji };

const TOKEN_RE = /:([A-Za-z0-9_-]{1,64}):/g;
const SHORT_MESSAGE_RE = /^(?::[A-Za-z0-9_-]{1,64}:\s*){1,3}$/;

/** Replace only shortcodes backed by this message's authenticated emoji tags. */
export function splitCustomEmojiText(
  value: string,
  emojisByShortcode: ReadonlyMap<string, CustomEmoji>,
): CustomEmojiTextPart[] {
  const parts: CustomEmojiTextPart[] = [];
  let last = 0;
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(value)) !== null) {
    const emoji = emojisByShortcode.get(match[1].toLowerCase());
    if (!emoji) continue;
    if (match.index > last) parts.push({ type: 'text', value: value.slice(last, match.index) });
    parts.push({ type: 'emoji', emoji });
    last = match.index + match[0].length;
  }
  if (last < value.length) parts.push({ type: 'text', value: value.slice(last) });
  return parts.length > 0 ? parts : [{ type: 'text', value }];
}

/** Return one to three tagged custom emojis when they are the entire message. */
export function shortCustomEmojiMessage(
  content: string,
  emojisByShortcode: ReadonlyMap<string, CustomEmoji>,
): CustomEmoji[] | null {
  const trimmed = content.trim();
  if (!SHORT_MESSAGE_RE.test(trimmed)) return null;
  const result: CustomEmoji[] = [];
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(trimmed)) !== null) {
    const emoji = emojisByShortcode.get(match[1].toLowerCase());
    if (!emoji) return null;
    result.push(emoji);
  }
  return result.length >= 1 && result.length <= 3 ? result : null;
}
