import groups from 'unicode-emoji-json/data-by-group.json';

/** A single emoji entry from `unicode-emoji-json` (pure data, no UI). */
export type EmojiItem = {
  emoji: string;
  name: string;
  slug: string;
  skin_tone_support: boolean;
};

export type EmojiGroup = {
  name: string;
  slug: string;
  emojis: EmojiItem[];
};

// The dataset ships as a JSON array of 9 Unicode CLDR groups (~1900 emojis).
// Cast through `unknown` so tsc doesn't expand the huge literal type.
export const EMOJI_GROUPS = groups as unknown as EmojiGroup[];

/** Flat list across all groups — the search corpus (matched by name/slug). */
export const ALL_EMOJI: EmojiItem[] = EMOJI_GROUPS.flatMap((g) => g.emojis);
