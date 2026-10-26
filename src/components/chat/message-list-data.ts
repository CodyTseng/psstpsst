import type { messages } from '@/db/schema';
import type { LoadedMessageWindow } from '@/lib/chat/loaded-message-window';
import type { PreparedBubbleRenderItem } from '@/services/conversation/message-tail-cache';
import type { PendingAttachment } from '@/stores/pending-attachments.store';

type MessageRow = typeof messages.$inferSelect;

export type ListItemSource =
  | {
      kind: 'message';
      message: MessageRow;
      prepared: PreparedBubbleRenderItem | null;
    }
  | { kind: 'pending'; pending: PendingAttachment };

export type ListItem = ListItemSource & {
  /** The adjacent older source. Stored on the item so a prepended history page
   * changes only the previous boundary cell, not renderItem. */
  older: ListItemSource | null;
  newer: ListItemSource | null;
  boundaryCreatedAt: number | null | undefined;
  boundaryIsSelf: boolean | null | undefined;
};

type CachedListItem = {
  prepared: PreparedBubbleRenderItem | null;
  olderSource: MessageRow | PendingAttachment | null;
  newerSource: MessageRow | PendingAttachment | null;
  boundaryCreatedAt: number | null | undefined;
  boundaryIsSelf: boolean | null | undefined;
  item: ListItem;
};

export class MessageListRowCache {
  readonly sources = new WeakMap<MessageRow | PendingAttachment, ListItemSource>();
  readonly items = new WeakMap<MessageRow | PendingAttachment, CachedListItem>();
}

type Options = {
  window: LoadedMessageWindow;
  count: number;
  pending: readonly PendingAttachment[];
  prepared: Readonly<Record<string, PreparedBubbleRenderItem>>;
  oldestBoundaryCreatedAt: number | null | undefined;
  boundaryIsSelf: boolean | null | undefined;
  cache: MessageListRowCache;
};

/** FlatList accepts ArrayLike data. Numeric reads materialize only requested
 * cells, instead of reversing and wrapping the complete retained history.
 * Only the small pending overlay is sorted and merged into message positions. */
export class MessageListData implements ArrayLike<ListItem> {
  readonly [index: number]: ListItem;
  private readonly pending: { position: number; value: PendingAttachment }[];
  readonly length: number;
  private readonly pendingIndices = new Map<string, number>();

  constructor(private readonly options: Options) {
    const { window, count } = options;
    const pending = options.pending.filter((row) =>
      !(row.uploadedUrl && window.hasAttachment(row.uploadedUrl, count)) &&
      !(row.status === 'sent' && row.sentRumorId && window.has(row.sentRumorId)),
    ).sort((a, b) =>
      (b.messageOrderAt ?? (b.startedAt ?? 0) * 1000) -
      (a.messageOrderAt ?? (a.startedAt ?? 0) * 1000),
    );
    this.pending = pending.map((value, pendingIndex) => {
      const orderAt = value.messageOrderAt ?? (value.startedAt ?? 0) * 1000;
      let low = 0;
      let high = count;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (window.rows[count - 1 - middle].orderAt > orderAt) low = middle + 1;
        else high = middle;
      }
      const position = low + pendingIndex;
      this.pendingIndices.set(value.tempId, position);
      return { position, value };
    });
    this.length = count + this.pending.length;
    return new Proxy(this, {
      get(target, property, receiver) {
        if (typeof property === 'string') {
          const index = Number(property);
          if (Number.isInteger(index) && index >= 0 && String(index) === property) return target.item(index);
        }
        return Reflect.get(target, property, receiver);
      },
    });
  }

  /** Read the shared position Map, then account for the small pending overlay. */
  get(id: string): number | undefined {
    const position = this.options.window.position(id);
    if (position < 0 || position >= this.options.count) return undefined;
    const messageIndex = this.options.count - 1 - position;
    let low = 0;
    let high = this.pending.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.pending[middle].position - middle <= messageIndex) low = middle + 1;
      else high = middle;
    }
    return messageIndex + low;
  }

  pendingIndex(id: string): number | undefined {
    return this.pendingIndices.get(id);
  }

  has(id: string): boolean {
    return this.get(id) != null;
  }

  private source(index: number): ListItemSource | null {
    if (index < 0 || index >= this.length) return null;
    let low = 0;
    let high = this.pending.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.pending[middle].position < index) low = middle + 1;
      else high = middle;
    }
    const overlay = this.pending[low];
    const { window, count, prepared, cache } = this.options;
    if (overlay?.position === index) {
      const cached = cache.sources.get(overlay.value);
      if (cached?.kind === 'pending') return cached;
      const source: ListItemSource = { kind: 'pending', pending: overlay.value };
      cache.sources.set(overlay.value, source);
      return source;
    }
    const message = window.rows[count - 1 - (index - low)];
    const presentation = prepared[message.id] ?? null;
    const cached = cache.sources.get(message);
    if (cached?.kind === 'message' && cached.prepared === presentation) return cached;
    const source: ListItemSource = { kind: 'message', message, prepared: presentation };
    cache.sources.set(message, source);
    return source;
  }

  private item(index: number): ListItem | undefined {
    const source = this.source(index);
    if (!source) return undefined;
    const older = this.source(index + 1);
    const newer = this.source(index - 1);
    const raw = source.kind === 'message' ? source.message : source.pending;
    const olderSource = older == null ? null : older.kind === 'message' ? older.message : older.pending;
    const newerSource = newer == null ? null : newer.kind === 'message' ? newer.message : newer.pending;
    const prepared = source.kind === 'message' ? source.prepared : null;
    const boundaryCreatedAt = older == null ? this.options.oldestBoundaryCreatedAt : undefined;
    const boundaryIsSelf = older == null ? this.options.boundaryIsSelf : undefined;
    const cached = this.options.cache.items.get(raw);
    if (cached && cached.prepared === prepared && cached.olderSource === olderSource &&
        cached.newerSource === newerSource && cached.boundaryCreatedAt === boundaryCreatedAt &&
        cached.boundaryIsSelf === boundaryIsSelf) return cached.item;
    const item: ListItem = { ...source, older, newer, boundaryCreatedAt, boundaryIsSelf };
    this.options.cache.items.set(raw, { prepared, olderSource, newerSource, boundaryCreatedAt, boundaryIsSelf, item });
    return item;
  }
}
