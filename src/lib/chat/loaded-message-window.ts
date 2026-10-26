import type { messages } from '@/db/schema';
import { MESSAGE_HISTORY_FETCH_SIZE } from '@/lib/message-window';
import { isMessageOrderNewer, type MessageOrderKey } from '@/lib/nostr/message-order';

type MessageRow = typeof messages.$inferSelect;

/** Locate the retained overlap when reconciling two sorted snapshots. */
function findOverlapPosition(rows: readonly MessageRow[], key: MessageOrderKey): number {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (isMessageOrderNewer(key, rows[middle])) low = middle + 1;
    else high = middle;
  }
  return rows[low]?.id === key.id ? low : -1;
}

type WindowKeys = {
  byId: Map<string, number>;
  attachments: Map<string, Set<string>>;
};

/** The array belongs to the pagination hook. No reverse, slice, or row copying. */
export class LoadedMessageWindow {
  constructor(
    readonly rows: readonly MessageRow[],
    private readonly keys: WindowKeys,
    private readonly livePositions: ReadonlyMap<string, number>,
    readonly lastSelf: MessageOrderKey | null,
    readonly origin: number,
    readonly stableCount: number,
    readonly stableLastSelf: MessageOrderKey | null,
  ) {}

  position(id: string): number {
    const coordinate = this.livePositions.get(id) ?? this.keys.byId.get(id);
    if (coordinate == null) return -1;
    const position = coordinate - this.origin;
    return this.rows[position]?.id === id ? position : -1;
  }

  get(id: string): MessageRow | undefined {
    const position = this.position(id);
    return position < 0 ? undefined : this.rows[position];
  }

  has(id: string): boolean {
    return this.position(id) >= 0;
  }

  hasAttachment(url: string, count: number): boolean {
    for (const id of this.keys.attachments.get(url) ?? []) {
      const position = this.position(id);
      if (position >= 0 && position < count) return true;
    }
    return false;
  }
}

/** Retained history extends only at its edges. The bounded live overlap can
 * replace/reorder messages even when its endpoints and count stay unchanged.
 * Each snapshot therefore owns a fresh live Map; stable history shares absolute
 * coordinates plus an origin. Promoting live rows never changes older snapshots.
 * Replacements/deletions outside the live overlap rebuild the stable Map. */
export class LoadedMessageWindowCache {
  private previous: LoadedMessageWindow | null = null;
  private keys: WindowKeys = { byId: new Map(), attachments: new Map() };

  constructor(private readonly fromSelf: (message: MessageRow) => boolean) {}

  read(rows: readonly MessageRow[]): LoadedMessageWindow {
    const previous = this.previous;
    if (previous?.rows === rows) return previous;
    const oldRows = previous?.rows ?? [];
    const retainedCount = previous?.stableCount ?? 0;
    const stableCount = Math.max(0, rows.length - MESSAGE_HISTORY_FETCH_SIZE);
    const first = retainedCount > 0 ? findOverlapPosition(rows, oldRows[0]) : -1;
    const last = retainedCount > 0 ? findOverlapPosition(rows, oldRows[retainedCount - 1]) : -1;
    const extendsEdges = first >= 0 && last - first + 1 === retainedCount && last < stableCount;
    const origin = previous && extendsEdges ? previous.origin - first : 0;
    const keys = extendsEdges ? this.keys : { byId: new Map<string, number>(), attachments: new Map<string, Set<string>>() };
    let stableLastSelf = extendsEdges ? previous!.stableLastSelf : null;
    const registerAttachment = (row: MessageRow) => {
      if (row.kind !== 15) return;
      const url = row.content.trim();
      const ids = keys.attachments.get(url) ?? new Set<string>();
      ids.add(row.id);
      keys.attachments.set(url, ids);
    };
    const addStable = (start: number, end: number) => {
      for (let index = start; index < end; index += 1) {
        const row = rows[index];
        keys.byId.set(row.id, origin + index);
        registerAttachment(row);
        if (this.fromSelf(row) && (!stableLastSelf || isMessageOrderNewer(row, stableLastSelf))) stableLastSelf = row;
      }
    };
    if (extendsEdges) {
      addStable(0, first);
      addStable(last + 1, stableCount);
    } else {
      addStable(0, stableCount);
    }
    const livePositions = new Map<string, number>();
    let lastSelf = stableLastSelf;
    for (let index = stableCount; index < rows.length; index += 1) {
      const row = rows[index];
      livePositions.set(row.id, origin + index);
      registerAttachment(row);
      if (this.fromSelf(row) && (!lastSelf || isMessageOrderNewer(row, lastSelf))) lastSelf = row;
    }
    const next = new LoadedMessageWindow(rows, keys, livePositions, lastSelf, origin, stableCount, stableLastSelf);
    this.keys = keys;
    this.previous = next;
    return next;
  }
}
