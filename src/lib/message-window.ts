import {
  isMessageOrderNewer,
  type MessageOrderKey,
} from '@/lib/nostr/message-order';

/** One small page of message/reaction rows shared by the warm cache and live tail. */
export const MESSAGES_PAGE_SIZE = 15;

/** One bounded cursor batch per database trip. */
export const MESSAGE_HISTORY_FETCH_SIZE = 60;

/** Release one UI-sized slice from the prefetched cursor batch at a time. */
export const MESSAGE_HISTORY_APPEND_SIZE = MESSAGES_PAGE_SIZE;

/** Refill the in-memory history buffer while two UI pages are still available. */
export const MESSAGE_HISTORY_PREFETCH_THRESHOLD = MESSAGES_PAGE_SIZE * 2;

/** Merge two newest-first cursor windows without sorting their shared prefix. */
export function mergeNewestFirstRows<Row extends MessageOrderKey>(
  left: readonly Row[],
  right: readonly Row[],
): Row[] {
  if (left.length === 0) return [...right];
  if (right.length === 0) return [...left];

  const merged: Row[] = [];
  const seen = new Set<string>();
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length || rightIndex < right.length) {
    const leftRow = left[leftIndex];
    const rightRow = right[rightIndex];
    let next: Row;
    if (!rightRow || (leftRow && isMessageOrderNewer(leftRow, rightRow))) {
      next = leftRow;
      leftIndex += 1;
    } else {
      next = rightRow;
      rightIndex += 1;
    }
    if (!seen.has(next.id)) {
      seen.add(next.id);
      merged.push(next);
    }
  }
  return merged;
}
