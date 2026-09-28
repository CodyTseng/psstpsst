import { isDifferentDay } from '@/lib/time';

export type TimelineBoundaryItem =
  | { kind: 'message'; message: { createdAt: number } }
  | {
      kind: 'pending';
      pending: { startedAt?: number; messageOrderAt?: number };
    };

export function timelineItemCreatedAt(item: TimelineBoundaryItem): number {
  if (item.kind === 'message') return item.message.createdAt;
  return item.pending.messageOrderAt == null
    ? (item.pending.startedAt ?? 0)
    : Math.floor(item.pending.messageOrderAt / 1000);
}

/** A row owns the date separator above it when it is oldest or follows another day. */
export function startsTimelineDay(
  item: TimelineBoundaryItem,
  older: TimelineBoundaryItem | undefined,
): boolean {
  return !older || isDifferentDay(timelineItemCreatedAt(item), timelineItemCreatedAt(older));
}

/** Resolve the oldest rendered row against an unrendered look-behind row. The
 * unknown state deliberately suppresses the separator so pagination can never
 * remove a provisional capsule and change the existing edge cell's height. */
export function startsLoadedTimelineDay(
  item: TimelineBoundaryItem,
  older: TimelineBoundaryItem | undefined,
  oldestBoundaryCreatedAt: number | null | undefined,
): boolean {
  if (older) return startsTimelineDay(item, older);
  if (oldestBoundaryCreatedAt === undefined) return false;
  if (oldestBoundaryCreatedAt === null) return true;
  return isDifferentDay(timelineItemCreatedAt(item), oldestBoundaryCreatedAt);
}

/** Unknown neighbours must not create a temporary large sender gap. */
export function startsLoadedSenderGroup(
  isSelf: boolean,
  olderIsSelf: boolean | null | undefined,
): boolean {
  return olderIsSelf === null || (olderIsSelf !== undefined && isSelf !== olderIsSelf);
}
