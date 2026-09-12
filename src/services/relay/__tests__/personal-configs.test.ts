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
let mockLoadAccountWriteRelays: jest.Mock<Promise<string[]>, [string]>;
let mockBuildSigner: jest.Mock;
let mockApplyMutedEvent: jest.Mock;
let mockApplyContactsEvent: jest.Mock;
let mockApplyBlockedEvent: jest.Mock;
let mockApplyMediaServersEvent: jest.Mock;
let mockApplyUserEmojiListEvent: jest.Mock;

jest.mock('@/db/client', () => ({
  db: {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        // The fake ignores the where clause; the service matches rows to keys
        // in JS, and tests seed only relevant rows.
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
    // The emoji-pack LRU prune runs raw SQL; the fake store never exceeds the cap.
    run: jest.fn(async () => {}),
  },
}));

jest.mock('../relay-pool', () => ({
  relayPool: { query: jest.fn((opts: QueryCall) => mockQuery(opts)) },
}));

jest.mock('../relay-list.service', () => ({
  loadAccountWriteRelays: jest.fn((pubkey: string) => mockLoadAccountWriteRelays(pubkey)),
}));

jest.mock('../../account/account.service', () => ({
  buildSigner: jest.fn((...args: unknown[]) => mockBuildSigner(...args)),
}));

// The domain reconcilers are mocked wholesale; the d-tag constants must mirror
// the real modules (they define the sync contract).
jest.mock('../../conversation/conversation-prefs.service', () => ({
  MUTED_D: 'psstpsst-muted',
  applyMutedEvent: jest.fn((...args: unknown[]) => mockApplyMutedEvent(...args)),
}));

jest.mock('../../contact/contact.service', () => ({
  CONTACTS_D: 'psstpsst-contacts',
  applyContactsEvent: jest.fn((...args: unknown[]) => mockApplyContactsEvent(...args)),
}));

jest.mock('../../dm/block.service', () => ({
  BLOCKED_D: 'psstpsst-blocked',
  applyBlockedEvent: jest.fn((...args: unknown[]) => mockApplyBlockedEvent(...args)),
}));

jest.mock('../../files/media-server.service', () => ({
  KIND_BLOSSOM_SERVER_LIST: 10063,
  applyMediaServersEvent: jest.fn((...args: unknown[]) => mockApplyMediaServersEvent(...args)),
}));

jest.mock('../../emoji/custom-emoji.service', () => ({
  applyUserEmojiListEvent: jest.fn((...args: unknown[]) => mockApplyUserEmojiListEvent(...args)),
}));

const ALL_D_TAGS = [
  'psstpsst-muted',
  'psstpsst-contacts',
  'psstpsst-blocked',
];

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

function seedFresh(event: Event, dTag = ''): void {
  seedRow({
    pubkey: event.pubkey,
    kind: event.kind,
    dTag,
    event,
    createdAt: event.created_at,
    fetchedAt: nowSeconds(),
  });
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

type Service = typeof import('../personal-configs.service');

function loadService(): Service {
  // The replaceable-events service holds module-level mirror/inflight state;
  // reload per test.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../personal-configs.service') as Service;
}

describe('syncPersonalConfigs', () => {
  const fakeSigner = { nip44Encrypt: jest.fn(), nip44Decrypt: jest.fn() };

  beforeEach(() => {
    mockStore.clear();
    mockQuery = jest.fn(async (_opts: QueryCall) => []);
    mockLoadAccountWriteRelays = jest.fn(async (_pubkey: string) => ['wss://relay.example']);
    mockBuildSigner = jest.fn(async () => fakeSigner);
    mockApplyMutedEvent = jest.fn(async () => {});
    mockApplyContactsEvent = jest.fn(async () => {});
    mockApplyBlockedEvent = jest.fn(async () => {});
    mockApplyMediaServersEvent = jest.fn(async () => {});
    mockApplyUserEmojiListEvent = jest.fn(async () => {});
    jest.resetModules();
  });

  it('refreshes every personal-config key in one multi-filter REQ and dispatches reconciles', async () => {
    const service = loadService();
    const muted = makeEvent('self', 30000, 100, 'psstpsst-muted');
    const contacts = makeEvent('self', 30000, 100, 'psstpsst-contacts');
    const media = makeEvent('self', 10063, 100);
    mockQuery.mockResolvedValue([muted, contacts, media]);

    await service.syncPersonalConfigs('self');

    expect(mockLoadAccountWriteRelays).toHaveBeenCalledWith('self');
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const call = mockQuery.mock.calls[0][0];
    expect(call.relays).toEqual(['wss://relay.example']);
    expect(call.filters).toEqual([
      { kinds: [10030, 10063], authors: ['self'] },
      { kinds: [30000], authors: ['self'], '#d': ALL_D_TAGS },
    ]);

    // Received events are persisted; missed keys get a negative-cache mark.
    expect(getRow('self', 30000, 'psstpsst-muted')?.event?.id).toBe(muted.id);
    expect(getRow('self', 10063)?.event?.id).toBe(media.id);
    expect(getRow('self', 10030)?.event).toBeNull();

    // Every reconciler got its stored event (null where absent).
    expect(mockApplyMutedEvent).toHaveBeenCalledWith('self', muted, fakeSigner);
    expect(mockApplyContactsEvent).toHaveBeenCalledWith('self', contacts, fakeSigner);
    expect(mockApplyBlockedEvent).toHaveBeenCalledWith('self', null, fakeSigner);
    expect(mockApplyMediaServersEvent).toHaveBeenCalledWith('self', media);
    expect(mockApplyUserEmojiListEvent).toHaveBeenCalledWith('self', null);
  });

  it('sends no relay query when every row is fresh and still reconciles from the cache', async () => {
    const service = loadService();
    const emojiList = makeEvent('self', 10030, 100);
    const media = makeEvent('self', 10063, 100);
    const muted = makeEvent('self', 30000, 100, 'psstpsst-muted');
    const contacts = makeEvent('self', 30000, 100, 'psstpsst-contacts');
    const blocked = makeEvent('self', 30000, 100, 'psstpsst-blocked');
    seedFresh(emojiList);
    seedFresh(media);
    seedFresh(muted, 'psstpsst-muted');
    seedFresh(contacts, 'psstpsst-contacts');
    seedFresh(blocked, 'psstpsst-blocked');

    await service.syncPersonalConfigs('self');

    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockApplyMutedEvent).toHaveBeenCalledWith('self', muted, fakeSigner);
    expect(mockApplyContactsEvent).toHaveBeenCalledWith('self', contacts, fakeSigner);
    expect(mockApplyBlockedEvent).toHaveBeenCalledWith('self', blocked, fakeSigner);
    expect(mockApplyMediaServersEvent).toHaveBeenCalledWith('self', media);
    expect(mockApplyUserEmojiListEvent).toHaveBeenCalledWith('self', emojiList);
  });

  it('skips the private-set reconcilers when no signer is available but still applies the public lists', async () => {
    const service = loadService();
    mockBuildSigner.mockRejectedValue(new Error('unknown account'));
    const media = makeEvent('self', 10063, 100);
    seedFresh(media);

    await service.syncPersonalConfigs('self');

    expect(mockApplyMutedEvent).not.toHaveBeenCalled();
    expect(mockApplyContactsEvent).not.toHaveBeenCalled();
    expect(mockApplyBlockedEvent).not.toHaveBeenCalled();
    expect(mockApplyMediaServersEvent).toHaveBeenCalledWith('self', media);
    expect(mockApplyUserEmojiListEvent).toHaveBeenCalledWith('self', null);
  });
});
