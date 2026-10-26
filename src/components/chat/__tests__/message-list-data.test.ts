import type { messages } from '@/db/schema';
import { LoadedMessageWindowCache } from '@/lib/chat/loaded-message-window';
import type { PendingAttachment } from '@/stores/pending-attachments.store';
import { MessageListData, MessageListRowCache } from '../message-list-data';

type Row = typeof messages.$inferSelect;
const row = (orderAt: number, overrides: Partial<Row> = {}): Row => ({
  accountPubkey: 'account', conversationKey: 'conversation', id: `id-${orderAt}`,
  senderPubkey: 'peer', kind: 14, content: '', createdAt: 1, orderAt,
  replyToId: null, subject: null, tags: [], rumor: {} as Row['rumor'],
  deliveryStatus: null, deliveryError: null, sourceRelays: null, ...overrides,
});
const pending = (orderAt: number, tempId: string): PendingAttachment => ({
  accountPubkey: 'account', conversationKey: 'conversation', tempId,
  localUri: 'local-file', mime: 'application/octet-stream',
  messageOrderAt: orderAt, status: 'paused',
});

function fixture() {
  const windows = new LoadedMessageWindowCache(() => false);
  const cache = new MessageListRowCache();
  return (rows: Row[], overlay: PendingAttachment[] = [], count = rows.length) => new MessageListData({
    window: windows.read(rows), count, pending: overlay, prepared: {},
    oldestBoundaryCreatedAt: null, boundaryIsSelf: null, cache,
  });
}
const ids = (data: MessageListData) => Array.from(data, (item) => item.kind === 'message' ? item.message.id : item.pending.tempId);

describe('lazy message list data', () => {
  it('merges pending rows and resolves message indices in both directions', () => {
    const data = fixture()([row(10), row(20), row(30)], [pending(25, 'p25'), pending(40, 'p40')]);
    expect(ids(data)).toEqual(['p40', 'id-30', 'p25', 'id-20', 'id-10']);
    expect(data.get('id-30')).toBe(1);
    expect(data.pendingIndex('p40')).toBe(0);
    expect(data.pendingIndex('p25')).toBe(2);
    expect(data.get('id-20')).toBe(3);
    expect(data.get('id-10')).toBe(4);
    expect(data.has('missing')).toBe(false);
    expect(data[1].older?.kind).toBe('pending');
    expect(data[1].newer?.kind).toBe('pending');
  });

  it('preserves equal-order pending precedence and multiple pending insertions', () => {
    const data = fixture()([row(10), row(20)], [pending(20, 'p1'), pending(20, 'p2')]);
    expect(ids(data)).toEqual(['p1', 'p2', 'id-20', 'id-10']);
    expect(data.get('id-20')).toBe(2);
  });

  it('keeps staged messages out of data and message-position lookup', () => {
    const data = fixture()([row(10), row(20), row(30)], [], 2);
    expect(ids(data)).toEqual(['id-20', 'id-10']);
    expect(data.has('id-30')).toBe(false);
    expect(data[1].boundaryCreatedAt).toBeNull();
    expect(data[0].boundaryCreatedAt).toBeUndefined();
  });

  it('removes an upload placeholder only when its stored message is in the displayed window', () => {
    const build = fixture();
    const rows = [row(10), row(20, { kind: 15, content: 'file-url' })];
    const upload = { ...pending(20, 'upload'), uploadedUrl: 'file-url' };
    expect(ids(build(rows, [upload], 1))).toEqual(['upload', 'id-10']);
    expect(ids(build(rows, [upload], 2))).toEqual(['id-20', 'id-10']);
  });

  it('reuses unchanged rows and repairs the old boundary when history expands', () => {
    const build = fixture();
    const rows = [row(10), row(20), row(30)];
    const before = build(rows);
    const interior = before[1];
    const oldest = before[2];
    const after = build([row(5), ...rows, row(40)]);
    expect(after[2]).toBe(interior);
    expect(after[3]).not.toBe(oldest);
    expect(after[3].older?.kind === 'message' && after[3].older.message.id).toBe('id-5');
    expect(before[2]).toEqual(oldest);
    expect(oldest.older).toBeNull();
    expect(before.get('id-20')).toBe(1);
    expect(after.get('id-20')).toBe(2);
  });

  it('does not materialize retained rows when constructing data or resolving an index', () => {
    const windows = new LoadedMessageWindowCache(() => false);
    const rows = Array.from({ length: 50_000 }, (_, index) => row(index));
    const window = windows.read(rows);
    const cache = new MessageListRowCache();
    const materialize = jest.spyOn(cache.items, 'set');
    const data = new MessageListData({ window, count: rows.length, pending: [], prepared: {},
      oldestBoundaryCreatedAt: null, boundaryIsSelf: null, cache });
    expect(data.length).toBe(50_000);
    expect(data.get('id-100')).toBe(49_899);
    expect(materialize).not.toHaveBeenCalled();
    expect(data[10].kind).toBe('message');
    expect(materialize).toHaveBeenCalledTimes(1);
    expect(data[10]).toBe(data[10]);
    expect(materialize).toHaveBeenCalledTimes(1);
  });
});
