import type { Rumor } from '@/db/schema/types';

import { pickTagValue } from './tags';

/** PsstPsst's authenticated, non-indexed millisecond ordering tag for private rumors. */
export const MESSAGE_ORDER_TAG = 'ms';

export type MessageOrderKey = { orderAt: number; id: string };

/**
 * Compare two message cursors by Nostr's replaceable-event freshness rule:
 * later timestamps win, and the lexicographically smaller event id wins ties.
 */
export function isMessageOrderNewer(
  candidate: MessageOrderKey,
  current: MessageOrderKey,
): boolean {
  return (
    candidate.orderAt > current.orderAt ||
    (candidate.orderAt === current.orderAt && candidate.id < current.id)
  );
}

/** Add a fresh `0..999` ordering tag, replacing any stale copy. */
export function withMessageOrderTag(tags: string[][], millisecond: number): string[][] {
  return [
    ...tags.filter((tag) => tag[0] !== MESSAGE_ORDER_TAG),
    [MESSAGE_ORDER_TAG, String(millisecond)],
  ];
}

/**
 * Return the normalized full ordering key. The tag carries only the millisecond
 * component; malformed values fall back to the legacy second floor.
 */
export function messageOrderAt(rumor: Pick<Rumor, 'created_at' | 'tags'>): number {
  const fallback = rumor.created_at * 1000;
  const raw = pickTagValue(rumor.tags, MESSAGE_ORDER_TAG);
  if (!raw || !/^\d+$/.test(raw)) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 999) return fallback;
  return fallback + parsed;
}
