import type { Event } from 'nostr-tools';

export const KIND_USER_EMOJI_LIST = 10030;
export const KIND_EMOJI_SET = 30030;

export const MAX_EMOJIS_PER_PACK = 256;
export const MAX_EMOJI_SHORTCODE_LENGTH = 64;
export const MAX_EMOJI_URL_LENGTH = 2_048;
export const MAX_EMOJI_PACK_TITLE_LENGTH = 80;

const SHORTCODE_RE = /^[A-Za-z0-9_-]+$/;
const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/;

export type CustomEmoji = {
  shortcode: string;
  url: string;
  /** `30030:<pubkey>:<d>` coordinate of the pack this emoji belongs to. */
  setAddress?: string;
};

export type EmojiPack = {
  coordinate: string;
  authorPubkey: string;
  identifier: string;
  title: string;
  image?: string;
  description?: string;
  emojis: CustomEmoji[];
  event: Event;
};

export type UserEmojiList = {
  standalone: CustomEmoji[];
  packCoordinates: string[];
};

export function normalizeEmojiShortcode(value: string): string {
  return value.trim().replace(/^:+/, '').replace(/:+$/, '').trim();
}

export function isValidEmojiShortcode(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_EMOJI_SHORTCODE_LENGTH &&
    SHORTCODE_RE.test(value)
  );
}

export function isValidEmojiUrl(value: string): boolean {
  if (value.length === 0 || value.length > MAX_EMOJI_URL_LENGTH) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function parseEmojiSetCoordinate(value: string): {
  authorPubkey: string;
  identifier: string;
} | null {
  const first = value.indexOf(':');
  const second = value.indexOf(':', first + 1);
  if (first < 0 || second < 0) return null;
  const kind = Number(value.slice(0, first));
  const authorPubkey = value.slice(first + 1, second).toLowerCase();
  const identifier = value.slice(second + 1);
  if (
    kind !== KIND_EMOJI_SET ||
    !HEX_PUBKEY_RE.test(authorPubkey) ||
    identifier.length === 0 ||
    identifier.length > 128
  ) {
    return null;
  }
  return { authorPubkey, identifier };
}

export function emojiSetCoordinate(authorPubkey: string, identifier: string): string {
  return `${KIND_EMOJI_SET}:${authorPubkey}:${identifier}`;
}

export function emojiSetCoordinateFromEvent(event: Event): string | null {
  if (event.kind !== KIND_EMOJI_SET) return null;
  const identifier = event.tags.find((tag) => tag[0] === 'd')?.[1];
  if (!identifier) return null;
  const coordinate = emojiSetCoordinate(event.pubkey, identifier);
  return parseEmojiSetCoordinate(coordinate) ? coordinate : null;
}

export function parseEmojiTag(tag: string[], fallbackSetAddress?: string): CustomEmoji | null {
  if (tag[0] !== 'emoji') return null;
  const shortcode = tag[1];
  const url = tag[2];
  if (!isValidEmojiShortcode(shortcode) || !isValidEmojiUrl(url)) return null;
  const explicitAddress = tag[3] && parseEmojiSetCoordinate(tag[3]) ? tag[3] : undefined;
  return {
    shortcode,
    url,
    setAddress: explicitAddress ?? fallbackSetAddress,
  };
}

export function buildEmojiTag(emoji: CustomEmoji): string[] {
  const tag = ['emoji', emoji.shortcode, emoji.url];
  if (emoji.setAddress) tag.push(emoji.setAddress);
  return tag;
}

export function parseEmojiSetEvent(event: Event): EmojiPack | null {
  const coordinate = emojiSetCoordinateFromEvent(event);
  if (!coordinate) return null;
  const parsedCoordinate = parseEmojiSetCoordinate(coordinate);
  if (!parsedCoordinate) return null;

  const seen = new Set<string>();
  const emojis: CustomEmoji[] = [];
  for (const tag of event.tags) {
    const emoji = parseEmojiTag(tag, coordinate);
    if (!emoji) continue;
    const key = emoji.shortcode.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    emojis.push(emoji);
    if (emojis.length >= MAX_EMOJIS_PER_PACK) break;
  }
  if (emojis.length === 0) return null;

  const value = (name: string, max: number) => {
    const raw = event.tags.find((tag) => tag[0] === name)?.[1]?.trim();
    return raw ? raw.slice(0, max) : undefined;
  };
  return {
    coordinate,
    authorPubkey: parsedCoordinate.authorPubkey,
    identifier: parsedCoordinate.identifier,
    title: value('title', MAX_EMOJI_PACK_TITLE_LENGTH) ?? '',
    image: value('image', MAX_EMOJI_URL_LENGTH),
    description: value('description', 280),
    emojis,
    event,
  };
}

export function parseUserEmojiListEvent(event: Event | null): UserEmojiList {
  if (!event || event.kind !== KIND_USER_EMOJI_LIST) {
    return { standalone: [], packCoordinates: [] };
  }
  const standalone: CustomEmoji[] = [];
  const packCoordinates: string[] = [];
  const seenEmoji = new Set<string>();
  const seenPack = new Set<string>();

  for (const tag of event.tags) {
    const emoji = parseEmojiTag(tag);
    if (emoji) {
      const key = `${emoji.shortcode.toLowerCase()}\n${emoji.url}`;
      if (!seenEmoji.has(key)) {
        seenEmoji.add(key);
        standalone.push(emoji);
      }
      continue;
    }
    if (tag[0] !== 'a' || !parseEmojiSetCoordinate(tag[1])) continue;
    if (!seenPack.has(tag[1])) {
      seenPack.add(tag[1]);
      packCoordinates.push(tag[1]);
    }
  }
  return { standalone, packCoordinates };
}

/** Extract valid custom emojis defined by a message's NIP-30 tags. */
export function customEmojisFromMessageTags(tags: string[][] | null | undefined): CustomEmoji[] {
  if (!tags) return [];
  const result: CustomEmoji[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    const emoji = parseEmojiTag(tag);
    if (!emoji) continue;
    const key = emoji.shortcode.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(emoji);
  }
  return result;
}

export function isNewerReplaceableEvent(next: Event, current: Event | null | undefined): boolean {
  if (!current) return true;
  if (next.created_at !== current.created_at) return next.created_at > current.created_at;
  return next.id.localeCompare(current.id) < 0;
}
