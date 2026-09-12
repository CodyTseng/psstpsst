import orderedEmoji from 'unicode-emoji-json/data-ordered-emoji.json';

type EmojiTrieNode = {
  children?: Map<string, EmojiTrieNode>;
  terminal?: boolean;
};

const MAX_EMOJI_COUNT = 3;
// Three current emoji sequences, including multiple skin-tone modifiers, fit
// comfortably inside this bound. Rejecting longer strings before allocating a
// compact copy keeps the check cheap for ordinary prose and pasted text.
const MAX_CANDIDATE_CODE_UNITS = 64;
const SKIN_TONE_MODIFIER = /\uD83C[\uDFFB-\uDFFF]/g;
const WHITESPACE = /\s/g;

const emojiTrie: EmojiTrieNode = {};

for (const emoji of orderedEmoji as unknown as string[]) {
  let node = emojiTrie;
  for (const codePoint of emoji) {
    const children = node.children ?? (node.children = new Map());
    let child = children.get(codePoint);
    if (!child) {
      child = {};
      children.set(codePoint, child);
    }
    node = child;
  }
  node.terminal = true;
}

/**
 * Return the display content when a message consists of one to three complete
 * emoji sequences, otherwise null. Whitespace does not count as content, and
 * skin tones are ignored only for lookup so the original glyphs stay intact.
 * The emoji data handles ZWJ families/professions, flags, and keycaps as one
 * sequence each without relying on Unicode property escapes missing in Hermes.
 */
export type ShortEmojiMessage = {
  content: string;
  count: number;
};

export function shortEmojiMessage(content: string): ShortEmojiMessage | null {
  if (content.length === 0 || content.length > MAX_CANDIDATE_CODE_UNITS) return null;

  const displayContent = content.trim();
  if (!displayContent) return null;

  const compact = displayContent.replace(WHITESPACE, '');
  const normalized = compact.replace(SKIN_TONE_MODIFIER, '');
  const codePoints = Array.from(normalized);
  let offset = 0;
  let emojiCount = 0;

  while (offset < codePoints.length) {
    let node = emojiTrie;
    let nextOffset = -1;

    for (let index = offset; index < codePoints.length; index += 1) {
      const child = node.children?.get(codePoints[index]);
      if (!child) break;
      node = child;
      if (node.terminal) nextOffset = index + 1;
    }

    if (nextOffset < 0) return null;
    emojiCount += 1;
    if (emojiCount > MAX_EMOJI_COUNT) return null;
    offset = nextOffset;
  }

  return emojiCount > 0 ? { content: displayContent, count: emojiCount } : null;
}

/** Compatibility helper for callers that only need the original display text. */
export function shortEmojiMessageContent(content: string): string | null {
  return shortEmojiMessage(content)?.content ?? null;
}
