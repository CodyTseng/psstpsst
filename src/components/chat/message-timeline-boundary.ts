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
