import type { Event } from 'nostr-tools';

import { fetchProfiles, PROFILE_TTL_SECONDS } from '../profile.service';

type Row = {
  pubkey: string;
  name: string | null;
  displayName: string | null;
  picture: string | null;
  nip05: string | null;
  lud06: string | null;
  lud16: string | null;
  about: string | null;
  rawEvent: Event | null;
  fetchedAt: number;
};

const mockStore = new Map<string, Row>();
let mockFetchReplaceable: jest.Mock<Promise<Event | null>, unknown[]>;
let mockPeerMetaRelays: jest.Mock<Promise<string[]>, unknown[]>;

jest.mock('@/db/client', () => ({
  db: {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        // The fake ignores the where clause; tests seed only relevant rows.
        // It stays awaitable (fetchProfiles' TTL read) while also exposing
        // limit() (getProfile).
        where: jest.fn(() =>
          Object.assign(Promise.resolve([...mockStore.values()]), {
            limit: jest.fn(async () => [...mockStore.values()]),
          }),
        ),
      })),
    })),
    insert: jest.fn(() => ({
      values: jest.fn((values: Partial<Row> & { pubkey: string }) => ({
        onConflictDoUpdate: jest.fn(async (config: { set: Partial<Row> }) => {
          const existing = mockStore.get(values.pubkey);
          if (existing) Object.assign(existing, config.set);
          else mockStore.set(values.pubkey, { ...mockEmptyRow(values.pubkey), ...values });
        }),
      })),
    })),
    update: jest.fn(() => ({
      set: jest.fn((values: Partial<Row>) => ({
        // The fake ignores the where clause; tests that hit UPDATE seed a
        // single row.
        where: jest.fn(async () => {
          for (const row of mockStore.values()) Object.assign(row, values);
        }),
      })),
    })),
  },
}));

jest.mock('../../relay/relay-pool', () => ({
  relayPool: { publishEvent: jest.fn() },
}));

jest.mock('../../relay/relay-router', () => ({
  fetchReplaceable: jest.fn((...args: unknown[]) => mockFetchReplaceable(...args)),
  peerMetaRelays: jest.fn((...args: unknown[]) => mockPeerMetaRelays(...args)),
}));

function mockEmptyRow(pubkey: string): Row {
  return {
    pubkey,
    name: null,
    displayName: null,
    picture: null,
    nip05: null,
    lud06: null,
    lud16: null,
    about: null,
    rawEvent: null,
    fetchedAt: 0,
  };
}

function seedRow(row: Partial<Row> & { pubkey: string }): Row {
  const full = { ...mockEmptyRow(row.pubkey), ...row };
  mockStore.set(row.pubkey, full);
  return full;
}

function getRow(pubkey: string): Row | undefined {
  return mockStore.get(pubkey);
}

let eventSerial = 0;
function makeProfileEvent(pubkey: string, createdAt: number, content = '{}'): Event {
  eventSerial += 1;
  return {
    id: `event-${eventSerial}`,
    pubkey,
    kind: 0,
    created_at: createdAt,
    tags: [],
    content,
    sig: 'sig',
  };
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

const STALE_AGE_SECONDS = 25 * 60 * 60; // just past the 24h TTL

describe('profile service', () => {
  beforeEach(() => {
    mockStore.clear();
    mockFetchReplaceable = jest.fn(async () => null);
    mockPeerMetaRelays = jest.fn(async () => ['wss://meta.example']);
  });

  describe('fetchProfiles TTL gate', () => {
    it('serves fresh rows from the table without touching the relays', async () => {
      seedRow({ pubkey: 'alice', name: 'Alice', fetchedAt: nowSeconds() });

      await fetchProfiles(['alice']);

      expect(mockPeerMetaRelays).not.toHaveBeenCalled();
      expect(mockFetchReplaceable).not.toHaveBeenCalled();
    });

    it('queries only the stale or missing pubkeys', async () => {
      const alice = seedRow({ pubkey: 'alice', name: 'Alice', fetchedAt: nowSeconds() });

      await fetchProfiles(['alice', 'bob']);

      expect(mockPeerMetaRelays).toHaveBeenCalledTimes(1);
      expect(mockPeerMetaRelays).toHaveBeenCalledWith('bob');
      expect(mockFetchReplaceable).toHaveBeenCalledTimes(1);
      expect(mockFetchReplaceable).toHaveBeenCalledWith(['wss://meta.example'], 0, 'bob');
      // The fresh row is left untouched; the miss gets a stub.
      expect(getRow('alice')).toBe(alice);
      expect(getRow('bob')).toMatchObject({ rawEvent: null });
    });

    it('refreshes a row whose fetchedAt is older than the TTL', async () => {
      seedRow({ pubkey: 'alice', name: 'Alice', fetchedAt: nowSeconds() - STALE_AGE_SECONDS });

      await fetchProfiles(['alice']);

      expect(mockFetchReplaceable).toHaveBeenCalledTimes(1);
    });
  });

  describe('storeProfileEvent (via fetchProfiles)', () => {
    it('stores a returned event with its parsed fields', async () => {
      const event = makeProfileEvent(
        'bob',
        100,
        JSON.stringify({ name: 'Bob', display_name: 'Bobby', picture: 'https://x/y.png' }),
      );
      mockFetchReplaceable.mockResolvedValue(event);

      await fetchProfiles(['bob']);

      const row = getRow('bob')!;
      expect(row.rawEvent?.id).toBe(event.id);
      expect(row.name).toBe('Bob');
      expect(row.displayName).toBe('Bobby');
      expect(row.picture).toBe('https://x/y.png');
      expect(row.fetchedAt).toBeGreaterThan(nowSeconds() - 60);
    });

    it('bumps fetchedAt when the cached event is already current', async () => {
      const event = makeProfileEvent('alice', 200, JSON.stringify({ name: 'Alice' }));
      seedRow({ pubkey: 'alice', rawEvent: event, name: 'Alice', fetchedAt: 1000 });
      // The relay echoes the same event (same created_at): nothing to store…
      mockFetchReplaceable.mockResolvedValue(makeProfileEvent('alice', 200, event.content));

      await fetchProfiles(['alice']);

      const row = getRow('alice')!;
      // …but the TTL marker moves, so the profile doesn't re-query every 24h.
      expect(row.rawEvent?.id).toBe(event.id);
      expect(row.fetchedAt).toBeGreaterThan(1000);
    });

    it('replaces the cached row when the returned event is newer', async () => {
      const stale = makeProfileEvent('alice', 100, JSON.stringify({ name: 'Old' }));
      seedRow({ pubkey: 'alice', rawEvent: stale, name: 'Old', fetchedAt: 1000 });
      const fresh = makeProfileEvent('alice', 200, JSON.stringify({ name: 'New' }));
      mockFetchReplaceable.mockResolvedValue(fresh);

      await fetchProfiles(['alice']);

      const row = getRow('alice')!;
      expect(row.rawEvent?.id).toBe(fresh.id);
      expect(row.name).toBe('New');
    });
  });

  describe('negative cache', () => {
    it('inserts a stub row for a pubkey with no event', async () => {
      await fetchProfiles(['dave']);

      const row = getRow('dave')!;
      expect(row.rawEvent).toBeNull();
      expect(row.name).toBeNull();
      expect(row.picture).toBeNull();
      expect(row.fetchedAt).toBeGreaterThan(nowSeconds() - 60);
    });

    it('a stub row gates re-fetching within the TTL', async () => {
      await fetchProfiles(['dave']);
      await fetchProfiles(['dave']);

      expect(mockFetchReplaceable).toHaveBeenCalledTimes(1);
    });

    it('a miss bumps fetchedAt without touching the stored event', async () => {
      const event = makeProfileEvent('alice', 100, JSON.stringify({ name: 'Alice' }));
      seedRow({
        pubkey: 'alice',
        rawEvent: event,
        name: 'Alice',
        fetchedAt: nowSeconds() - STALE_AGE_SECONDS,
      });

      await fetchProfiles(['alice']);

      const row = getRow('alice')!;
      expect(row.rawEvent?.id).toBe(event.id);
      expect(row.name).toBe('Alice');
      expect(row.fetchedAt).toBeGreaterThan(nowSeconds() - 60);
    });
  });

  it('exposes a 24h TTL', () => {
    expect(PROFILE_TTL_SECONDS).toBe(24 * 60 * 60);
  });
});
