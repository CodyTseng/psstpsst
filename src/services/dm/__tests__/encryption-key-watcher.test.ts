import { encryptionKeyWatcher } from '../encryption-key-watcher';
import { relayPool } from '../../relay/relay-pool';

const mockPersistEvidence = jest.fn(async () => {});
const mockInsertValues = jest.fn(() => ({ onConflictDoUpdate: mockPersistEvidence }));
const mockUpdateWhere = jest.fn(async () => {});
const mockGetAnnouncement = jest.fn();
const mockSelect = jest.fn(() => ({
  from: () => ({ where: () => ({ get: mockGetAnnouncement }) }),
}));

jest.mock('@/db/client', () => ({
  db: {
    select: () => mockSelect(),
    insert: () => ({ values: mockInsertValues }),
    update: () => ({ set: () => ({ where: mockUpdateWhere }) }),
  },
}));
jest.mock('../../relay/relay-router', () => ({
  resolvePeerOutbox: jest.fn(async () => { throw new Error('network unavailable'); }),
  pickPeerRelays: (relays: string[]) => relays,
  capDeliveryRelays: (relays: string[]) => relays,
  uniq: (relays: string[]) => [...new Set(relays)],
}));
jest.mock('../../relay/relay-list.service', () => ({
  fetchDmRelays: jest.fn(async () => { throw new Error('network unavailable'); }),
}));
jest.mock('../../relay/relay-pool', () => ({
  relayPool: { subscribe: jest.fn(() => jest.fn()), query: jest.fn(async () => []) },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockGetAnnouncement.mockReset();
  encryptionKeyWatcher.destroy();
});

afterEach(() => encryptionKeyWatcher.destroy());

it('does not scan stored announcements at startup', async () => {
  await encryptionKeyWatcher.init({ dmRelays: ['wss://own.example'] });
  expect(mockSelect).not.toHaveBeenCalled();
});

it('loads one stored announcement on demand instead of scanning at startup', async () => {
  mockGetAnnouncement.mockResolvedValue({
    encryptionPubkey: 'b'.repeat(64),
    createdAt: 123,
    eventId: 'event-id',
    fetchedAt: 456,
  });
  await encryptionKeyWatcher.init({ dmRelays: ['wss://own.example'] });

  await expect(encryptionKeyWatcher.resolveAnnouncement('a'.repeat(64))).resolves.toEqual({
    encryptionPubkey: 'b'.repeat(64),
    createdAt: 123,
    eventId: 'event-id',
    fetchedAt: 456,
  });
  expect(mockSelect).toHaveBeenCalledTimes(1);
  expect(relayPool.query).not.toHaveBeenCalled();
});

it('skips the relay query while the local fetch time is under one day old', async () => {
  const now = 100_000;
  mockGetAnnouncement.mockResolvedValue({
    encryptionPubkey: 'b'.repeat(64),
    createdAt: 123,
    eventId: 'event-id',
    fetchedAt: now - 60,
  });
  await encryptionKeyWatcher.init({ dmRelays: ['wss://own.example'] });

  await encryptionKeyWatcher.refreshAnnouncementIfStale('a'.repeat(64), 86_400, now);

  expect(relayPool.query).not.toHaveBeenCalled();
});

it('queries relays once and advances the local fetch time when the row is stale', async () => {
  const now = 200_000;
  mockGetAnnouncement.mockResolvedValue({
    encryptionPubkey: 'b'.repeat(64),
    createdAt: 123,
    eventId: 'event-id',
    fetchedAt: now - 86_401,
  });
  await encryptionKeyWatcher.init({ dmRelays: ['wss://own.example'] });

  await encryptionKeyWatcher.refreshAnnouncementIfStale('a'.repeat(64), 86_400, now);

  expect(relayPool.query).toHaveBeenCalledTimes(1);
  expect(mockUpdateWhere).toHaveBeenCalledTimes(1);
  expect(encryptionKeyWatcher.peekAnnouncement('a'.repeat(64))?.fetchedAt).toBe(now);
});
