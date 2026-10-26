import type { messages } from '@/db/schema';
import { LoadedMessageWindowCache } from '../loaded-message-window';

type Row = typeof messages.$inferSelect;
const row = (orderAt: number, overrides: Partial<Row> = {}): Row => ({
  accountPubkey: 'account', conversationKey: 'conversation', id: `id-${orderAt}`,
  senderPubkey: 'peer', kind: 14, content: '', createdAt: 1, orderAt,
  replyToId: null, subject: null, tags: [], rumor: {} as Row['rumor'],
  deliveryStatus: null, deliveryError: null, sourceRelays: null, ...overrides,
});

describe('loaded message windows', () => {
  it('indexes both ends incrementally without visiting retained history', () => {
    const fromSelf = jest.fn((message: Row) => message.senderPubkey === 'self');
    const cache = new LoadedMessageWindowCache(fromSelf);
    const rows = Array.from({ length: 50_000 }, (_, index) => row(index + 100));
    const original = cache.read(rows);
    fromSelf.mockClear();
    const older = Array.from({ length: 15 }, (_, index) => row(index + 85));
    const newer = [row(50_100, { senderPubkey: 'self' })];
    let reads = 0;
    const expanded = new Proxy([...older, ...rows, ...newer], {
      get(target, property, receiver) {
        if (typeof property === 'string' && /^\d+$/.test(property)) reads += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    const next = cache.read(expanded);
    expect(fromSelf).toHaveBeenCalledTimes(16 + 60);
    expect(reads).toBeLessThan(200);
    expect(next.position('id-85')).toBe(0);
    expect(next.position('id-100')).toBe(15);
    expect(next.position('id-50100')).toBe(50_015);
    expect(next.lastSelf?.id).toBe('id-50100');
    expect(original.position('id-100')).toBe(0);
    expect(original.has('id-85')).toBe(false);
    expect(original.has('id-50100')).toBe(false);
  });

  it('resolves IDs by Map and offset with constant array access', () => {
    const rows = Array.from({ length: 50_000 }, (_, index) => row(index));
    let reads = 0;
    const observed = new Proxy(rows, {
      get(target, property, receiver) {
        if (typeof property === 'string' && /^\d+$/.test(property)) reads += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    const window = new LoadedMessageWindowCache(() => false).read(observed);
    reads = 0;
    expect(window.position('id-30000')).toBe(30_000);
    expect(reads).toBe(1);
    expect(window.position('missing')).toBe(-1);
    expect(reads).toBe(1);
  });

  it('keeps old coordinates stable across alternating older and newer pages', () => {
    const cache = new LoadedMessageWindowCache(() => false);
    const middle = Array.from({ length: 100 }, (_, index) => row(index + 10));
    const first = cache.read(middle);
    const older = cache.read([row(5), ...middle]);
    const newer = cache.read([row(5), ...middle, row(110)]);
    const both = cache.read([row(1), row(5), ...middle, row(110), row(120)]);
    expect([first.origin, older.origin, newer.origin, both.origin]).toEqual([0, -1, -1, -2]);
    expect([first.position('id-10'), older.position('id-10'), newer.position('id-10'), both.position('id-10')]).toEqual([0, 1, 1, 2]);
    expect(first.has('id-5')).toBe(false);
    expect(older.has('id-110')).toBe(false);
    expect(both.position('id-120')).toBe(103);
  });

  it('rebuilds when the new window has no overlap', () => {
    const fromSelf = jest.fn(() => false);
    const cache = new LoadedMessageWindowCache(fromSelf);
    cache.read([row(1), row(2), row(3)]);
    fromSelf.mockClear();
    const next = cache.read([row(100), row(101)]);
    expect(fromSelf).toHaveBeenCalledTimes(2);
    expect(next.has('id-1')).toBe(false);
    expect(next.position('id-100')).toBe(0);
  });

  it('rebuilds on an insertion or deletion within the retained overlap', () => {
    const cache = new LoadedMessageWindowCache(() => false);
    cache.read([row(1), row(3), row(5)]);
    const inserted = cache.read([row(1), row(2), row(3), row(5)]);
    expect(inserted.position('id-2')).toBe(1);
    expect(inserted.position('id-5')).toBe(3);
    const removed = cache.read([row(1), row(2), row(5)]);
    expect(removed.has('id-3')).toBe(false);
    expect(removed.position('id-5')).toBe(2);
  });

  it('reindexes a changed live tail even when both endpoints and the count stay unchanged', () => {
    const cache = new LoadedMessageWindowCache(() => false);
    const rows = Array.from({ length: 100 }, (_, index) => row(index + 1));
    const original = cache.read(rows);
    const late = row(90.5);
    const refreshed = [...rows.slice(0, 84), ...rows.slice(85, 90), late, ...rows.slice(90)];
    const next = cache.read(refreshed);
    expect(next.rows).toHaveLength(rows.length);
    expect(next.position('id-85')).toBe(-1);
    expect(next.position('id-86')).toBe(84);
    expect(next.position(late.id)).toBe(89);
    expect(original.position('id-85')).toBe(84);
    expect(original.position('id-86')).toBe(85);
    expect(original.has(late.id)).toBe(false);
    const expanded = cache.read([...refreshed, ...Array.from({ length: 65 }, (_, index) => row(index + 101))]);
    expect(expanded.position(late.id)).toBe(89);
    expect(expanded.position('id-86')).toBe(84);
  });

  it('reads replacement row values from the current snapshot without rebuilding keys', () => {
    const cache = new LoadedMessageWindowCache(() => false);
    const original = cache.read([row(1), row(2)]);
    const changed = row(2, { deliveryStatus: 'sent' });
    const next = cache.read([row(1), changed]);
    expect(next.get(changed.id)).toBe(changed);
    expect(original.get(changed.id)?.deliveryStatus).toBeNull();
  });

  it('preserves equal-timestamp ordering when both edges extend', () => {
    const cache = new LoadedMessageWindowCache(() => false);
    const rows = [row(1, { id: 'c' }), row(1, { id: 'b' })];
    const original = cache.read(rows);
    const extended = cache.read([row(1, { id: 'd' }), ...rows, row(1, { id: 'a' })]);
    expect(extended.position('d')).toBe(0);
    expect(extended.position('c')).toBe(1);
    expect(extended.position('b')).toBe(2);
    expect(extended.position('a')).toBe(3);
    expect(extended.position('missing')).toBe(-1);
    expect(original.position('c')).toBe(0);
    expect(original.has('a')).toBe(false);
  });

  it('isolates attachment membership and self boundaries across snapshots', () => {
    const cache = new LoadedMessageWindowCache((message) => message.senderPubkey === 'self');
    const original = cache.read([row(1)]);
    const next = cache.read([row(1), row(2, { kind: 15, content: 'file-url', senderPubkey: 'self' })]);
    expect(original.hasAttachment('file-url', 1)).toBe(false);
    expect(original.lastSelf).toBeNull();
    expect(next.hasAttachment('file-url', 1)).toBe(false);
    expect(next.hasAttachment('file-url', 2)).toBe(true);
    expect(next.lastSelf?.id).toBe('id-2');
  });
});
