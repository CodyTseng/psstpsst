import type { Event } from 'nostr-tools';

type Row = {
  pubkey: string;
  kind: number;
  dTag: string;
  event: Event | null;
  createdAt: number | null;
  fetchedAt: number;
};

type QueryCall = {
  label?: string;
  relays: string[];
  filters: Record<string, unknown>[];
};

const mockStore = new Map<string, Row>();
let mockQuery: jest.Mock<Promise<Event[]>, [QueryCall]>;

jest.mock('@/db/client', () => ({
  db: {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        // The fake ignores the where clause; the service matches rows to keys
        // in JS, and tests seed only relevant rows.
        where: jest.fn(async () => {
          return [...mockStore.values()];
        }),
      })),
    })),
    insert: jest.fn(() => ({
      values: jest.fn((values: Row) => ({
        onConflictDoUpdate: jest.fn(async (config: { set: Partial<Row> }) => {
          const key = mockRowKey(values.pubkey, values.kind, values.dTag);
          const existing = mockStore.get(key);
          if (existing) Object.assign(existing, config.set);
          else mockStore.set(key, { ...values });
        }),
      })),
    })),
    // The emoji-pack LRU prune runs raw SQL; the fake store never exceeds the cap.
    run: jest.fn(async () => {}),
  },
}));

jest.mock('../relay-pool', () => ({
  relayPool: { query: jest.fn((opts: QueryCall) => mockQuery(opts)) },
}));

function mockRowKey(pubkey: string, kind: number, dTag: string): string {
  return JSON.stringify([pubkey, kind, dTag]);
}

function seedRow(row: Row): void {
  mockStore.set(mockRowKey(row.pubkey, row.kind, row.dTag), row);
}

function getRow(pubkey: string, kind: number, dTag = ''): Row | undefined {
  return mockStore.get(mockRowKey(pubkey, kind, dTag));
}

let eventSerial = 0;
function makeEvent(pubkey: string, kind: number, createdAt: number, dTag?: string): Event {
  eventSerial += 1;
  return {
    id: `event-${eventSerial}`,
    pubkey,
    kind,
    created_at: createdAt,
    tags: dTag != null ? [['d', dTag]] : [],
    content: '',
    sig: 'sig',
  };
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

type Service = typeof import('../replaceable-events.service');

function loadService(): Service {
  // The service holds module-level mirror/inflight state; reload per test.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../replaceable-events.service') as Service;
}

describe('replaceable-events service', () => {
  beforeEach(() => {
    mockStore.clear();
    mockQuery = jest.fn(async (_opts: QueryCall) => []);
    jest.resetModules();
  });

  describe('storeReplaceableEvent', () => {
    it('derives the dTag from the first d tag for addressable kinds', async () => {
      const service = loadService();
      await service.storeReplaceableEvent(makeEvent('alice', 30030, 100, 'pack1'));
      await service.storeReplaceableEvent(makeEvent('alice', 30030, 100));
      await service.storeReplaceableEvent(makeEvent('alice', 10002, 100));

      expect(getRow('alice', 30030, 'pack1')?.event?.kind).toBe(30030);
      expect(getRow('alice', 30030, '')?.event?.kind).toBe(30030);
      expect(getRow('alice', 10002, '')?.event?.kind).toBe(10002);
      expect(mockStore.size).toBe(3);
    });

    it('replaces the stored event when the incoming one is newer', async () => {
      const service = loadService();
      const older = makeEvent('alice', 10002, 100);
      const newer = makeEvent('alice', 10002, 200);

      await expect(service.storeReplaceableEvent(older)).resolves.toBe(true);
      await expect(service.storeReplaceableEvent(newer)).resolves.toBe(true);

      expect(getRow('alice', 10002)?.event?.id).toBe(newer.id);
      expect(getRow('alice', 10002)?.createdAt).toBe(200);
    });

    it('does not roll back to an older event but still bumps fetchedAt', async () => {
      const service = loadService();
      const newer = makeEvent('alice', 10002, 200);
      await service.storeReplaceableEvent(newer);
      const before = getRow('alice', 10002)!.fetchedAt;
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const older = makeEvent('alice', 10002, 100);
      await expect(service.storeReplaceableEvent(older)).resolves.toBe(false);

      const row = getRow('alice', 10002)!;
      expect(row.event?.id).toBe(newer.id);
      expect(row.createdAt).toBe(200);
      expect(row.fetchedAt).toBeGreaterThan(before);
    });
  });

  describe('markReplaceableFetched', () => {
    it('inserts a stub row for an unknown key', async () => {
      const service = loadService();
      await service.markReplaceableFetched({ pubkey: 'dave', kind: 10002 });

      const row = getRow('dave', 10002)!;
      expect(row.event).toBeNull();
      expect(row.createdAt).toBeNull();
      expect(row.fetchedAt).toBeGreaterThan(0);
    });

    it('bumps fetchedAt without touching a stored event', async () => {
      const service = loadService();
      const event = makeEvent('alice', 10002, 200);
      seedRow({ pubkey: 'alice', kind: 10002, dTag: '', event, createdAt: 200, fetchedAt: 1 });

      await service.markReplaceableFetched({ pubkey: 'alice', kind: 10002 });

      const row = getRow('alice', 10002)!;
      expect(row.event?.id).toBe(event.id);
      expect(row.createdAt).toBe(200);
      expect(row.fetchedAt).toBeGreaterThan(1);
    });
  });

  describe('getReplaceableEvents', () => {
    it('returns stored events aligned with the requested keys', async () => {
      const service = loadService();
      const event = makeEvent('alice', 10002, 200);
      seedRow({ pubkey: 'alice', kind: 10002, dTag: '', event, createdAt: 200, fetchedAt: 1 });

      const result = await service.getReplaceableEvents([
        { pubkey: 'alice', kind: 10002 },
        { pubkey: 'bob', kind: 10002 },
      ]);

      expect(result[0]?.id).toBe(event.id);
      expect(result[1]).toBeNull();
    });
  });

  describe('ensureReplaceableFresh', () => {
    it('sends no query when every key is fresh', async () => {
      const service = loadService();
      const event = makeEvent('alice', 10002, 200);
      seedRow({
        pubkey: 'alice',
        kind: 10002,
        dTag: '',
        event,
        createdAt: 200,
        fetchedAt: nowSeconds(),
      });

      const onUpdated = jest.fn();
      await service.ensureReplaceableFresh([{ pubkey: 'alice', kind: 10002 }], {
        ttlSeconds: 3600,
        relays: ['wss://relay.example'],
        onUpdated,
      });

      expect(mockQuery).not.toHaveBeenCalled();
      expect(onUpdated).not.toHaveBeenCalled();
    });

    it('refreshes keys whose fetchedAt is older than the TTL', async () => {
      const service = loadService();
      seedRow({
        pubkey: 'alice',
        kind: 10002,
        dTag: '',
        event: null,
        createdAt: null,
        fetchedAt: nowSeconds() - 7200,
      });

      await service.ensureReplaceableFresh([{ pubkey: 'alice', kind: 10002 }], {
        ttlSeconds: 3600,
        relays: ['wss://relay.example'],
      });

      expect(mockQuery).toHaveBeenCalledTimes(1);
      // The miss gets a fresh negative-cache mark.
      expect(getRow('alice', 10002)!.fetchedAt).toBeGreaterThan(nowSeconds() - 60);
    });

    it('does not cache a failed lookup and retries on the next refresh', async () => {
      const service = loadService();
      const options = { ttlSeconds: 3600, relays: ['wss://relay.example'] };
      mockQuery.mockRejectedValueOnce(new Error('network unavailable'));
      await expect(service.ensureReplaceableFresh([{ pubkey: 'alice', kind: 10002 }], options))
        .rejects.toThrow('network unavailable');
      expect(getRow('alice', 10002)).toBeUndefined();
      await service.ensureReplaceableFresh([{ pubkey: 'alice', kind: 10002 }], options);
      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(getRow('alice', 10002)?.event).toBeNull();
    });

    it('builds one multi-filter REQ merging plain keys and grouping #d keys', async () => {
      const service = loadService();
      await service.ensureReplaceableFresh(
        [
          { pubkey: 'alice', kind: 10002 },
          { pubkey: 'alice', kind: 10063 },
          { pubkey: 'bob', kind: 30030, dTag: 'pack1' },
          { pubkey: 'bob', kind: 30030, dTag: 'pack2' },
        ],
        { ttlSeconds: 3600, relays: ['wss://relay.example'] },
      );

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const call = mockQuery.mock.calls[0][0];
      expect(call.relays).toEqual(['wss://relay.example']);
      expect(call.filters).toEqual([
        { kinds: [10002, 10063], authors: ['alice'] },
        { kinds: [30030], authors: ['bob'], '#d': ['pack1', 'pack2'] },
      ]);
      // Every key got a negative-cache stub.
      expect(mockStore.size).toBe(4);
    });

    it('stores received events, marks misses, and calls onUpdated once', async () => {
      const service = loadService();
      const event = makeEvent('alice', 10002, 200);
      mockQuery.mockResolvedValue([event]);
      const onUpdated = jest.fn();

      await service.ensureReplaceableFresh(
        [
          { pubkey: 'alice', kind: 10002 },
          { pubkey: 'alice', kind: 10063 },
        ],
        { ttlSeconds: 3600, relays: ['wss://relay.example'], onUpdated },
      );

      expect(getRow('alice', 10002)?.event?.id).toBe(event.id);
      expect(getRow('alice', 10063)?.event).toBeNull();
      expect(onUpdated).toHaveBeenCalledTimes(1);
    });

    it('ignores relay events that were not requested', async () => {
      const service = loadService();
      mockQuery.mockResolvedValue([makeEvent('mallory', 10002, 200)]);

      await service.ensureReplaceableFresh([{ pubkey: 'alice', kind: 10002 }], {
        ttlSeconds: 3600,
        relays: ['wss://relay.example'],
      });

      expect(getRow('mallory', 10002)).toBeUndefined();
      expect(getRow('alice', 10002)?.event).toBeNull();
    });

    it('groups a relay resolver by identical relay sets', async () => {
      const service = loadService();
      const relays = async (key: { pubkey: string }) =>
        key.pubkey === 'alice' ? ['wss://a.example'] : ['wss://b.example'];

      await service.ensureReplaceableFresh(
        [
          { pubkey: 'alice', kind: 10002 },
          { pubkey: 'alice', kind: 10063 },
          { pubkey: 'bob', kind: 10002 },
        ],
        { ttlSeconds: 3600, relays },
      );

      expect(mockQuery).toHaveBeenCalledTimes(2);
      const byRelay = new Map(mockQuery.mock.calls.map((call) => [call[0].relays[0], call[0]]));
      expect(byRelay.get('wss://a.example')?.filters).toEqual([
        { kinds: [10002, 10063], authors: ['alice'] },
      ]);
      expect(byRelay.get('wss://b.example')?.filters).toEqual([
        { kinds: [10002], authors: ['bob'] },
      ]);
    });

    it('deduplicates concurrent refreshes of the same key', async () => {
      const service = loadService();
      let release!: (events: Event[]) => void;
      mockQuery.mockReturnValue(new Promise((resolve) => (release = resolve)));

      const first = service.ensureReplaceableFresh([{ pubkey: 'alice', kind: 10002 }], {
        ttlSeconds: 3600,
        relays: ['wss://relay.example'],
      });
      const second = service.ensureReplaceableFresh([{ pubkey: 'alice', kind: 10002 }], {
        ttlSeconds: 3600,
        relays: ['wss://relay.example'],
      });

      // Flush the async read/group chain inside ensureReplaceableFresh.
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
      expect(mockQuery).toHaveBeenCalledTimes(1);

      release([]);
      await Promise.all([first, second]);
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });
  });
});
