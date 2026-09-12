import type { Event } from 'nostr-tools';

import { DISCOVERY_RELAYS, normalizeRelayUrl } from '@/lib/nostr/relay-url';

import { KIND_DM_RELAY_LIST, KIND_RELAY_LIST_METADATA } from '../../crypto/nip17-gift-wrap';

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
let mockFetchReplaceable: jest.Mock<Promise<Event | null>, unknown[]>;
let mockPeerMetaRelays: jest.Mock<Promise<string[]>, unknown[]>;
let mockPublishEvent: jest.Mock<Promise<void>, unknown[]>;

jest.mock('../configuration-publish.service', () => ({
  prepareConfiguration: (_pubkey: string, _kind: number, _d: string, task: () => Promise<unknown>) => task(),
  publishConfiguration: async (_pubkey: string, signer: { signEvent: (template: unknown) => Promise<Event> }, template: unknown) => {
    const event = await signer.signEvent(template);
    await jest.requireActual('../replaceable-events.service').storeReplaceableEvent(event);
    await mockPublishEvent(event);
    return event;
  },
}));

jest.mock('@/db/client', () => ({
  db: {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        // The fake ignores the where clause; tests seed only relevant rows.
        where: jest.fn(async () => [...mockStore.values()]),
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
    transaction: jest.fn(async (fn: (tx: unknown) => Promise<void>) =>
      fn({
        delete: jest.fn(() => ({ where: jest.fn(() => ({ run: jest.fn(async () => {}) })) })),
        insert: jest.fn(() => ({ values: jest.fn(() => ({ run: jest.fn(async () => {}) })) })),
      }),
    ),
  },
}));

jest.mock('../relay-pool', () => ({
  relayPool: {
    query: jest.fn((opts: QueryCall) => mockQuery(opts)),
    publishEvent: jest.fn((opts: unknown) => mockPublishEvent(opts)),
  },
}));

jest.mock('../relay-router', () => {
  // Keep the real parseRelayListMetadata; stub the network-touching helpers.
  const actual = jest.requireActual('../relay-router');
  return {
    ...actual,
    fetchReplaceable: jest.fn((...args: unknown[]) => mockFetchReplaceable(...args)),
    peerMetaRelays: jest.fn((...args: unknown[]) => mockPeerMetaRelays(...args)),
  };
});

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
function makeEvent(
  pubkey: string,
  kind: number,
  createdAt: number,
  tags: string[][] = [],
): Event {
  eventSerial += 1;
  return {
    id: `event-${eventSerial}`,
    pubkey,
    kind,
    created_at: createdAt,
    tags,
    content: '',
    sig: 'sig',
  };
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

const NORMALIZED_DISCOVERY = DISCOVERY_RELAYS.map(normalizeRelayUrl);

type Service = typeof import('../relay-list.service');

function loadService(): Service {
  // The service holds a module-level cache; the replaceable-events service it
  // uses holds mirror/inflight state. Reload both per test.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../relay-list.service') as Service;
}

describe('relay-list service', () => {
  beforeEach(() => {
    mockStore.clear();
    mockQuery = jest.fn(async (_opts: QueryCall) => []);
    mockFetchReplaceable = jest.fn(async () => null);
    mockPeerMetaRelays = jest.fn(async () => ['wss://meta.example']);
    mockPublishEvent = jest.fn(async () => {});
    jest.resetModules();
  });

  describe('loadAccountWriteRelays / loadAccountReadRelays', () => {
    it('parses read/write markers from a fresh stored kind-10002 event without a relay query', async () => {
      const service = loadService();
      const event = makeEvent('self', KIND_RELAY_LIST_METADATA, 100, [
        ['r', 'wss://both.example'],
        ['r', 'wss://write.example', 'write'],
        ['r', 'wss://read.example', 'read'],
        ['r', 'wss://unknown.example', 'future-marker'],
        ['r', 'wss://empty-marker.example', ''],
      ]);
      seedRow({
        pubkey: 'self',
        kind: KIND_RELAY_LIST_METADATA,
        dTag: '',
        event,
        createdAt: 100,
        fetchedAt: nowSeconds(),
      });

      await expect(service.loadAccountWriteRelays('self')).resolves.toEqual([
        'wss://both.example',
        'wss://write.example',
        'wss://empty-marker.example',
      ]);
      await expect(service.loadAccountReadRelays('self')).resolves.toEqual([
        'wss://both.example',
        'wss://read.example',
        'wss://empty-marker.example',
      ]);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('bootstraps from discovery relays and falls back to them when no list exists', async () => {
      const service = loadService();

      await expect(service.loadAccountWriteRelays('self')).resolves.toEqual(NORMALIZED_DISCOVERY);
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery.mock.calls[0][0].relays).toEqual(NORMALIZED_DISCOVERY);
      expect(mockQuery.mock.calls[0][0].filters).toEqual([
        { kinds: [KIND_RELAY_LIST_METADATA], authors: ['self'] },
      ]);
      // The miss is negative-cached…
      expect(getRow('self', KIND_RELAY_LIST_METADATA)?.event).toBeNull();

      // …so a repeat call within the TTL asks neither the relays nor re-fetches.
      await expect(service.loadAccountReadRelays('self')).resolves.toEqual(NORMALIZED_DISCOVERY);
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('refreshes a stale row and returns the updated list', async () => {
      const service = loadService();
      const stale = makeEvent('self', KIND_RELAY_LIST_METADATA, 100, [
        ['r', 'wss://old.example'],
      ]);
      seedRow({
        pubkey: 'self',
        kind: KIND_RELAY_LIST_METADATA,
        dTag: '',
        event: stale,
        createdAt: 100,
        fetchedAt: nowSeconds() - 25 * 3600,
      });
      const fresh = makeEvent('self', KIND_RELAY_LIST_METADATA, 200, [
        ['r', 'wss://new.example'],
      ]);
      mockQuery.mockResolvedValue([fresh]);

      await expect(service.loadAccountWriteRelays('self')).resolves.toEqual([
        'wss://new.example',
      ]);
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(getRow('self', KIND_RELAY_LIST_METADATA)?.event?.id).toBe(fresh.id);
    });
  });

  describe('fetchDmRelays', () => {
    it('serves a fresh persisted row without touching relays', async () => {
      const service = loadService();
      const event = makeEvent('peer', KIND_DM_RELAY_LIST, 100, [
        ['relay', 'wss://dm1.example'],
      ]);
      seedRow({
        pubkey: 'peer',
        kind: KIND_DM_RELAY_LIST,
        dTag: '',
        event,
        createdAt: 100,
        fetchedAt: nowSeconds(),
      });
      const onRelayQuery = jest.fn();

      await expect(service.fetchDmRelays({ pubkey: 'peer', onRelayQuery })).resolves.toEqual([
        'wss://dm1.example',
      ]);
      expect(mockFetchReplaceable).not.toHaveBeenCalled();
      expect(mockPeerMetaRelays).not.toHaveBeenCalled();
      expect(onRelayQuery).not.toHaveBeenCalled();
    });

    it('queries relays on a cache miss, stores the event, then serves the memory cache', async () => {
      const service = loadService();
      const event = makeEvent('peer', KIND_DM_RELAY_LIST, 100, [
        ['relay', 'wss://dm1.example'],
      ]);
      mockFetchReplaceable.mockResolvedValue(event);
      const onRelayQuery = jest.fn();

      await expect(service.fetchDmRelays({ pubkey: 'peer', onRelayQuery })).resolves.toEqual([
        'wss://dm1.example',
      ]);
      expect(mockFetchReplaceable).toHaveBeenCalledTimes(1);
      expect(onRelayQuery).toHaveBeenCalledTimes(1);
      expect(getRow('peer', KIND_DM_RELAY_LIST)?.event?.id).toBe(event.id);

      // Second call: memory hit — no table read, no relay query.
      await expect(service.fetchDmRelays({ pubkey: 'peer' })).resolves.toEqual([
        'wss://dm1.example',
      ]);
      expect(mockFetchReplaceable).toHaveBeenCalledTimes(1);
    });

    it('negative-caches a miss and does not re-query within the TTL', async () => {
      const service = loadService();
      mockFetchReplaceable.mockResolvedValue(null);

      await expect(service.fetchDmRelays({ pubkey: 'peer' })).resolves.toEqual([]);
      expect(mockFetchReplaceable).toHaveBeenCalledTimes(1);
      expect(getRow('peer', KIND_DM_RELAY_LIST)).toMatchObject({
        event: null,
        createdAt: null,
      });

      // The fresh negative-cache row gates the relay path.
      await expect(service.fetchDmRelays({ pubkey: 'peer' })).resolves.toEqual([]);
      expect(mockFetchReplaceable).toHaveBeenCalledTimes(1);
    });

    it('refreshes a stale persisted row from relays', async () => {
      const service = loadService();
      const stale = makeEvent('peer', KIND_DM_RELAY_LIST, 100, [
        ['relay', 'wss://old-dm.example'],
      ]);
      seedRow({
        pubkey: 'peer',
        kind: KIND_DM_RELAY_LIST,
        dTag: '',
        event: stale,
        createdAt: 100,
        fetchedAt: nowSeconds() - 25 * 3600,
      });
      const fresh = makeEvent('peer', KIND_DM_RELAY_LIST, 200, [
        ['relay', 'wss://new-dm.example'],
      ]);
      mockFetchReplaceable.mockResolvedValue(fresh);

      await expect(service.fetchDmRelays({ pubkey: 'peer' })).resolves.toEqual([
        'wss://new-dm.example',
      ]);
      expect(mockFetchReplaceable).toHaveBeenCalledTimes(1);
      expect(getRow('peer', KIND_DM_RELAY_LIST)?.event?.id).toBe(fresh.id);
    });

    it('force skips both caches and re-queries relays', async () => {
      const service = loadService();
      const stored = makeEvent('peer', KIND_DM_RELAY_LIST, 100, [
        ['relay', 'wss://old-dm.example'],
      ]);
      seedRow({
        pubkey: 'peer',
        kind: KIND_DM_RELAY_LIST,
        dTag: '',
        event: stored,
        createdAt: 100,
        fetchedAt: nowSeconds(),
      });
      const fresh = makeEvent('peer', KIND_DM_RELAY_LIST, 200, [
        ['relay', 'wss://new-dm.example'],
      ]);
      mockFetchReplaceable.mockResolvedValue(fresh);

      await expect(service.fetchDmRelays({ pubkey: 'peer', force: true })).resolves.toEqual([
        'wss://new-dm.example',
      ]);
      expect(mockFetchReplaceable).toHaveBeenCalledTimes(1);
    });
  });

  describe('applyDmRelayListEvent', () => {
    it('persists live events to the table and warms the memory cache', async () => {
      const service = loadService();
      const event = makeEvent('peer', KIND_DM_RELAY_LIST, 100, [
        ['relay', 'wss://dm1.example'],
      ]);
      service.applyDmRelayListEvent(event);

      // storeReplaceableEvent is fire-and-forget; flush its async chain.
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
      expect(getRow('peer', KIND_DM_RELAY_LIST)?.event?.id).toBe(event.id);

      await expect(service.fetchDmRelays({ pubkey: 'peer' })).resolves.toEqual([
        'wss://dm1.example',
      ]);
      expect(mockFetchReplaceable).not.toHaveBeenCalled();
    });
  });

  describe('saveAndPublishWriteRelays', () => {
    const signer = {
      signEvent: jest.fn(async (template: Partial<Event>) => ({
        ...template, id: 'signed-write-list', pubkey: 'self', sig: 'sig',
      } as Event)),
    } as never;

    it('refreshes and preserves remote read membership, extension tags, and content', async () => {
      const service = loadService();
      const remote = makeEvent('self', KIND_RELAY_LIST_METADATA, nowSeconds() - 1, [
        ['r', 'wss://read.example', 'read', 'extension'],
        ['r', 'wss://both.example'],
        ['r', 'wss://kept.example'],
        ['r', 'wss://old-write.example', 'write'],
        ['client', 'other-app'],
        ['r', 'wss://future.example', 'future-marker'],
        ['r', 'wss://empty-marker.example', ''],
      ]);
      remote.content = 'extension content';
      mockFetchReplaceable.mockResolvedValue(remote);
      const saved = await service.saveAndPublishWriteRelays({
        accountPubkey: 'self', signer,
        relays: ['wss://kept.example/', 'wss://NEW.example/', 'wss://new.example'],
      });
      expect(saved.tags).toEqual([
        ['r', 'wss://read.example', 'read', 'extension'],
        ['r', 'wss://both.example', 'read'],
        ['r', 'wss://kept.example', 'read'],
        ['client', 'other-app'],
        ['r', 'wss://future.example', 'future-marker'],
        ['r', 'wss://empty-marker.example', 'read'],
        ['r', 'wss://kept.example', 'write'],
        ['r', 'wss://new.example', 'write'],
      ]);
      expect(saved.content).toBe('extension content');
      await expect(service.loadAccountWriteRelays('self')).resolves.toEqual([
        'wss://kept.example', 'wss://new.example',
      ]);
      await expect(service.loadAccountReadRelays('self')).resolves.toEqual([
        'wss://read.example', 'wss://both.example', 'wss://kept.example', 'wss://empty-marker.example',
      ]);
      expect(getRow('self', KIND_DM_RELAY_LIST)).toBeUndefined();
    });

    it('preserves cached read relays when the completed lookup returns no event', async () => {
      const service = loadService();
      const cached = makeEvent('self', KIND_RELAY_LIST_METADATA, nowSeconds(), [
        ['r', 'wss://read.example', 'read'], ['r', 'wss://old.example', 'write'],
      ]);
      seedRow({ pubkey: 'self', kind: KIND_RELAY_LIST_METADATA, dTag: '',
        event: cached, createdAt: cached.created_at, fetchedAt: nowSeconds() });
      const saved = await service.saveAndPublishWriteRelays({
        accountPubkey: 'self', signer, relays: ['wss://new.example'],
      });
      expect(saved.tags).toEqual([
        ['r', 'wss://read.example', 'read'], ['r', 'wss://new.example', 'write'],
      ]);
      expect(mockFetchReplaceable.mock.calls[0][0]).toContain('wss://old.example');
    });

    it('creates write-only metadata after a completed miss', async () => {
      const saved = await loadService().saveAndPublishWriteRelays({
        accountPubkey: 'self', signer, relays: ['wss://new.example'],
      });
      expect(saved.tags).toEqual([['r', 'wss://new.example', 'write']]);
    });

    it('does not publish when refreshing existing metadata fails', async () => {
      mockFetchReplaceable.mockRejectedValue(new Error('offline'));
      await expect(loadService().saveAndPublishWriteRelays({
        accountPubkey: 'self', signer, relays: ['wss://new.example'],
      })).rejects.toThrow('offline');
      expect(mockPublishEvent).not.toHaveBeenCalled();
      expect(getRow('self', KIND_RELAY_LIST_METADATA)).toBeUndefined();
    });

    it('rejects an empty write list before querying or publishing', async () => {
      await expect(loadService().saveAndPublishWriteRelays({
        accountPubkey: 'self', signer, relays: [],
      })).rejects.toThrow('At least one');
      expect(mockFetchReplaceable).not.toHaveBeenCalled();
      expect(mockPublishEvent).not.toHaveBeenCalled();
    });
  });

  describe('saveAndPublishDmRelays', () => {
    it.each([false, true])('publishes only the DM list, preserving existing NIP-65 metadata: %s', async (hasMetadata) => {
      const service = loadService();
      const existing = makeEvent('self', KIND_RELAY_LIST_METADATA, nowSeconds(), [
        ['r', 'wss://read.example', 'read'],
        ['r', 'wss://write.example', 'write'],
      ]);
      if (hasMetadata) {
        seedRow({ pubkey: 'self', kind: KIND_RELAY_LIST_METADATA, dTag: '',
          event: existing, createdAt: existing.created_at, fetchedAt: nowSeconds() });
      }
      const signer = {
        signEvent: jest.fn(async (template: Partial<Event>) => ({
          id: `signed-${template.kind}`,
          pubkey: 'self',
          kind: template.kind!,
          created_at: template.created_at!,
          tags: template.tags ?? [],
          content: template.content ?? '',
          sig: 'sig',
        })),
        // The service only calls signEvent here.
      } as never;

      await service.saveAndPublishDmRelays({
        accountPubkey: 'self',
        signer,
        relays: ['wss://dm.example'],
      });

      const dmRow = getRow('self', KIND_DM_RELAY_LIST);
      expect(dmRow?.event?.kind).toBe(KIND_DM_RELAY_LIST);
      expect(dmRow?.event?.tags).toEqual([['relay', 'wss://dm.example']]);
      const metaRow = getRow('self', KIND_RELAY_LIST_METADATA);
      expect(metaRow?.event).toEqual(hasMetadata ? existing : undefined);
      expect(mockPublishEvent).toHaveBeenCalledTimes(1);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });
});
