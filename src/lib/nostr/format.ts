/**
 * Shorten a long identifier for display as `head…tail` (or `head…` when
 * `tail` is 0). Used for pubkeys, npubs and event ids so the truncation rule
 * lives in one place instead of scattered slice() calls.
 */
export function abbreviate(value: string, head = 8, tail = 4): string {
  if (!value) return '';
  if (value.length <= head + tail + 1) return value;
  return tail > 0 ? `${value.slice(0, head)}…${value.slice(-tail)}` : `${value.slice(0, head)}…`;
}

/** Hex pubkey → `xxxxxxxx…xxxx`. */
export const abbreviatePubkey = (hex: string): string => abbreviate(hex, 8, 4);

/** Bech32 npub → `npub1xxxxx…xxxx`. Kept short — the single abbreviation used
 * everywhere an npub is shown truncated (names, profile, share card). */
export const abbreviateNpub = (npub: string): string => abbreviate(npub, 10, 4);
