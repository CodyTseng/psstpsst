import type { Event } from 'nostr-tools';

import { DISCOVERY_RELAYS } from '@/lib/nostr/relay-url';

const SELF = 'self-pubkey';
const PRIVATE_SET_D_TAGS = [
  'psstpsst-muted',
  'psstpsst-contacts',
  'psstpsst-blocked',
];

type ReplRow = {
  pubkey: string;
  kind: number;
  dTag: string;
  event: Event | null;
  createdAt: number | null;
  fetchedAt: number;
};

type RelayListRow = {
  accountPubkey: string;
  relayUrl: string;
  read: boolean;
  write: boolean;
  updatedAt: number;
};

type SubscribeCall = {
  label?: string;
  relays: string[];
  filters?: Record<string, unknown>[];
  onEvent: (event: Event, relayUrl: string) => void;
  signAuth?: unknown;
};

const mockReplStore = new Map<string, ReplRow>();
let mockRelayListRows: RelayListRow[] = [];
let mockSubscribeCalls: SubscribeCall[] = [];
let mockUnsubscribes: jest.Mock[] = [];
let mockLoadAccountDmRelays: jest.Mock<Promise<string[]>, unknown[]>;
let mockLoadAccountWriteRelays: jest.Mock<Promise<string[]>, unknown[]>;
let mockGetSigner: jest.Mock;
let mockApplyMutedEvent: jest.Mock;
let mockApplyContactsEvent: jest.Mock;
let mockApplyBlockedEvent: jest.Mock;
let mockApplyMediaServersEvent: jest.Mock;
let mockApplyUserEmojiListEvent: jest.Mock;
const mockHealthySubscriptions = new Set<string>();
let mockAppState: 'active' | 'background' = 'active';

const fakeSigner = { nip44Encrypt: jest.fn(), nip44Decrypt: jest.fn() };

jest.mock('@/platform', () => ({
  platform: {
    appState: {
      currentState: jest.fn(() => mockAppState),
    },
  },
}));

jest.mock('@/db/client', () => {
  // One fake backing both tables the touched services use: `relay_lists`
  // (applyOwnDmRelayListEvent) and `replaceable_events` (the real
  // replaceable-events service). Routed by the selected/inserted shape; where
  // clauses are ignored and tests seed only relevant rows.
  const db = {
    select: jest.fn((selection: Record<string, unknown>) => ({
      from: jest.fn(() => {
        if ('updatedAt' in selection) {
          return {
            where: jest.fn(async () =>
              mockRelayListRows.map((r) => ({ updatedAt: r.updatedAt })),
            ),
          };
        }
        return { where: jest.fn(async () => [...mockReplStore.values()]) };
      }),
    })),
    insert: jest.fn(() => ({
      values: jest.fn((values: Record<string, unknown>) => {
        if ('relayUrl' in values) {
          return {
            run: jest.fn(async () => {
              mockRelayListRows.push(values as unknown as RelayListRow);
            }),
          };
        }
        const row = values as unknown as ReplRow;
        return {
          onConflictDoUpdate: jest.fn(async (config: { set: Partial<ReplRow> }) => {
            const key = JSON.stringify([row.pubkey, row.kind, row.dTag]);
            const existing = mockReplStore.get(key);
            if (existing) Object.assign(existing, config.set);
            else mockReplStore.set(key, { ...row });
          }),
        };
      }),
    })),
    delete: jest.fn(() => ({
      where: jest.fn(() => ({
        run: jest.fn(async () => {
          mockRelayListRows = [];
        }),
      })),
    })),
    run: jest.fn(async () => {}),
    transaction: jest.fn(),
  };
  db.transaction = jest.fn(async (fn: (tx: unknown) => Promise<void>) => fn(db));
  return { db };
});

jest.mock('../../relay/relay-pool', () => ({
  relayPool: {
    hasHealthySubscription: (label: string) => mockHealthySubscriptions.has(label),
    subscribe: jest.fn((opts: SubscribeCall) => {
      mockSubscribeCalls.push(opts);
      const unsub = jest.fn();
      mockUnsubscribes.push(unsub);
      return unsub;
    }),
  },
}));

jest.mock('../../relay/relay-list.service', () => {
  const actual = jest.requireActual('../../relay/relay-list.service');
  return {
    ...actual,
    loadAccountDmRelays: jest.fn((pubkey: string) => mockLoadAccountDmRelays(pubkey)),
    loadAccountWriteRelays: jest.fn((pubkey: string) =>
      mockLoadAccountWriteRelays(pubkey),
    ),
  };
});

jest.mock('../../relay/relay-router', () => {
  const actual = jest.requireActual('../../relay/relay-router');
  return {
    ...actual,
    fetchReplaceable: jest.fn(async () => null),
    peerMetaRelays: jest.fn(async () => []),
  };
});

// The domain reconcilers are mocked wholesale; the d-tag constants must mirror
// the real modules (they define the routing contract).
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
  applyMediaServersEvent: jest.fn((...args: unknown[]) =>
    mockApplyMediaServersEvent(...args),
  ),
}));

jest.mock('../../emoji/custom-emoji.service', () => ({
  applyUserEmojiListEvent: jest.fn((...args: unknown[]) =>
    mockApplyUserEmojiListEvent(...args),
  ),
}));

let eventSerial = 0;
function makeEvent(
  kind: number,
  createdAt: number,
  tags: string[][] = [],
  id?: string,
): Event {
  eventSerial += 1;
  return {
    id: id ?? `event-${eventSerial}`,
    pubkey: SELF,
    kind,
    created_at: createdAt,
    tags,
    content: '',
    sig: 'sig',
  };
}

/** Seed a stored replaceable row that `getReplaceableEvent` can read back
 * through the real replaceable-events service (fresh module → empty mirror →
 * the fake db). */
function seedStoredReplaceable(event: Event): void {
  mockReplStore.set(JSON.stringify([event.pubkey, event.kind, '']), {
    pubkey: event.pubkey,
    kind: event.kind,
    dTag: '',
    event,
    createdAt: event.created_at,
    fetchedAt: Math.floor(Date.now() / 1000),
  });
}

/** Deliveries run through per-lane promise chains with a macrotask yield
 * between events; drain enough rounds for every queued delivery to settle. */
async function flush(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

type Handlers = {
  onKeyRequest: jest.Mock;
  onKeyTransfer: jest.Mock;
  onKeyAnnouncement: jest.Mock;
  onOwnRelayListsChanged: jest.Mock;
};

type StreamModule = typeof import('../self-event-stream.service');

function loadStream(): StreamModule['selfEventStream'] {
  // The stream is a singleton with per-session state; reload per test.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('../self-event-stream.service') as StreamModule).selfEventStream;
}

function findSub(label: string): SubscribeCall | undefined {
  // Last match: a re-start opens a fresh subscription under the same label.
  return mockSubscribeCalls.filter((c) => c.label === label).pop();
}

function deliver(label: string, event: Event): void {
  const call = findSub(label);
  if (!call) throw new Error(`no subscription labelled ${label}`);
  call.onEvent(event, call.relays[0]);
}

describe('selfEventStream', () => {
  let handlers: Handlers;

  beforeEach(() => {
    mockReplStore.clear();
    mockHealthySubscriptions.clear();
    mockRelayListRows = [];
    mockSubscribeCalls = [];
    mockUnsubscribes = [];
    mockLoadAccountDmRelays = jest.fn(async () => ['wss://dm-a.example/', 'wss://shared.example']);
    mockLoadAccountWriteRelays = jest.fn(async () => ['wss://shared.example', 'wss://write-b.example']);
    mockGetSigner = jest.fn(async () => fakeSigner);
    mockApplyMutedEvent = jest.fn(async () => {});
    mockApplyContactsEvent = jest.fn(async () => {});
    mockApplyBlockedEvent = jest.fn(async () => {});
    mockApplyMediaServersEvent = jest.fn(async () => {});
    mockApplyUserEmojiListEvent = jest.fn(async () => {});
    mockAppState = 'active';
    handlers = {
      onKeyRequest: jest.fn(),
      onKeyTransfer: jest.fn(),
      onKeyAnnouncement: jest.fn(),
      onOwnRelayListsChanged: jest.fn(),
    };
    jest.resetModules();
  });

  async function startStream() {
    const stream = loadStream();
    stream.configure({
      accountPubkey: SELF,
      signAuth: jest.fn(),
      getSigner: mockGetSigner,
      handlers,
    });
    await stream.start();
    return stream;
  }

  it('requires every configured watcher to be healthy and clears health on destroy', async () => {
    const stream = await startStream();
    expect(stream.isHealthy()).toBe(false);
    mockHealthySubscriptions.add('self.dm');
    mockHealthySubscriptions.add('self.write');
    expect(stream.isHealthy()).toBe(false);
    mockHealthySubscriptions.add('self.discovery');
    expect(stream.isHealthy()).toBe(true);
    stream.destroy();
    expect(stream.isHealthy()).toBe(false);
  });

  it('opens the fixed REQ table over DM / write-only / discovery-only relay sets', async () => {
    const sinceFloor = Math.floor(Date.now() / 1000) - 300;
    await startStream();
    const sinceCeil = Math.floor(Date.now() / 1000) - 300;

    expect(mockSubscribeCalls.map((c) => c.label)).toEqual([
      'self.dm',
      'self.write',
      'self.discovery',
    ]);

    // URLs are normalized (trailing slash dropped) before set arithmetic.
    const dm = findSub('self.dm')!;
    expect(dm.relays).toEqual(['wss://dm-a.example', 'wss://shared.example']);
    expect(dm.filters).toHaveLength(3);
    expect(dm.filters![0]).toEqual({ kinds: [10044], authors: [SELF] });
    const keySyncFilters = dm.filters!.slice(1);
    expect(keySyncFilters).toEqual([
      { kinds: [4454], authors: [SELF], since: expect.any(Number) },
      { kinds: [4455], authors: [SELF], '#p': [SELF], since: expect.any(Number) },
    ]);
    for (const filter of keySyncFilters) {
      const since = filter.since as number;
      expect(since).toBeGreaterThanOrEqual(sinceFloor);
      expect(since).toBeLessThanOrEqual(sinceCeil);
    }

    const write = findSub('self.write')!;
    expect(write.relays).toEqual(['wss://write-b.example']);
    expect(write.filters).toEqual([
      { kinds: [10044], authors: [SELF] },
      { kinds: [4454], authors: [SELF], since: expect.any(Number) },
      { kinds: [4455], authors: [SELF], '#p': [SELF], since: expect.any(Number) },
      { kinds: [30000], authors: [SELF], '#d': PRIVATE_SET_D_TAGS },
      { kinds: [10030], authors: [SELF] },
      { kinds: [10063], authors: [SELF] },
      { kinds: [10002, 10050], authors: [SELF] },
    ]);

    const discovery = findSub('self.discovery')!;
    expect(discovery.relays).toEqual([...DISCOVERY_RELAYS]);
    expect(discovery.filters).toEqual([
      { kinds: [10044], authors: [SELF] },
      { kinds: [30000], authors: [SELF], '#d': PRIVATE_SET_D_TAGS },
      { kinds: [10030], authors: [SELF] },
      { kinds: [10063], authors: [SELF] },
      { kinds: [10002, 10050], authors: [SELF] },
    ]);
  });

  it('skips a REQ whose relay set is empty', async () => {
    // DM relays cover the whole discovery set; write relays add nothing.
    mockLoadAccountDmRelays = jest.fn(async () => [...DISCOVERY_RELAYS]);
    mockLoadAccountWriteRelays = jest.fn(async () => [...DISCOVERY_RELAYS]);
    await startStream();

    expect(mockSubscribeCalls.map((c) => c.label)).toEqual(['self.dm']);
  });

  it('dispatches a key change synchronously without waiting for a UI timer', async () => {
    await startStream();
    jest.useFakeTimers();
    try {
      const announcement = makeEvent(10044, 100);
      deliver('self.dm', announcement);
      expect(handlers.onKeyAnnouncement).toHaveBeenCalledWith(announcement);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('routes 4454/4455/10044 to their handlers', async () => {
    await startStream();

    const request = makeEvent(4454, 100);
    const transfer = makeEvent(4455, 100);
    const announcement = makeEvent(10044, 100);
    deliver('self.dm', request);
    deliver('self.write', transfer);
    deliver('self.discovery', announcement);
    await flush();

    expect(handlers.onKeyRequest).toHaveBeenCalledWith(request);
    expect(handlers.onKeyTransfer).toHaveBeenCalledWith(transfer);
    expect(handlers.onKeyAnnouncement).toHaveBeenCalledWith(announcement);
  });

  it('does not strand event lanes behind a suspended background timer', async () => {
    mockAppState = 'background';
    jest.useFakeTimers();
    try {
      await startStream();
      const request = makeEvent(4454, 100);

      deliver('self.dm', request);
      for (let i = 0; i < 6; i += 1) await Promise.resolve();

      expect(handlers.onKeyRequest).toHaveBeenCalledWith(request);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('routes 30000 private sets by d-tag and 10030/10063 to their reconcilers', async () => {
    await startStream();

    const muted = makeEvent(30000, 100, [['d', 'psstpsst-muted']]);
    const contacts = makeEvent(30000, 100, [['d', 'psstpsst-contacts']]);
    const blocked = makeEvent(30000, 100, [['d', 'psstpsst-blocked']]);
    const emoji = makeEvent(10030, 100);
    const media = makeEvent(10063, 100);
    for (const event of [muted, contacts, blocked, emoji, media]) {
      deliver('self.write', event);
    }
    await flush();

    expect(mockApplyMutedEvent).toHaveBeenCalledWith(SELF, muted, fakeSigner);
    expect(mockApplyContactsEvent).toHaveBeenCalledWith(SELF, contacts, fakeSigner);
    expect(mockApplyBlockedEvent).toHaveBeenCalledWith(SELF, blocked, fakeSigner);
    expect(mockApplyUserEmojiListEvent).toHaveBeenCalledWith(SELF, emoji);
    expect(mockApplyMediaServersEvent).toHaveBeenCalledWith(SELF, media);
  });

  it('dedups the same event id across REQs', async () => {
    await startStream();

    const request = makeEvent(4454, 100);
    deliver('self.dm', request);
    deliver('self.write', request);
    await flush();

    expect(handlers.onKeyRequest).toHaveBeenCalledTimes(1);
  });

  it('collapses replaceable events per address: larger created_at wins, smaller id breaks ties', async () => {
    await startStream();

    const base = makeEvent(10063, 100, [], 'id-m');
    const smallerIdTie = makeEvent(10063, 100, [], 'id-a'); // tie, smaller id → newer
    const largerIdTie = makeEvent(10063, 100, [], 'id-z'); // tie, larger id → dropped
    const newer = makeEvent(10063, 150);
    const older = makeEvent(10063, 50);
    for (const event of [base, smallerIdTie, largerIdTie, newer, older]) {
      deliver('self.write', event);
    }
    await flush();

    expect(mockApplyMediaServersEvent).toHaveBeenCalledTimes(3);
    expect(mockApplyMediaServersEvent).toHaveBeenNthCalledWith(1, SELF, base);
    expect(mockApplyMediaServersEvent).toHaveBeenNthCalledWith(2, SELF, smallerIdTie);
    expect(mockApplyMediaServersEvent).toHaveBeenNthCalledWith(3, SELF, newer);
  });

  it('isolates a throwing handler from its own lane and the others', async () => {
    handlers.onKeyRequest
      .mockImplementationOnce(() => {
        throw new Error('boom');
      })
      .mockImplementationOnce(() => {});
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await startStream();

    const first = makeEvent(4454, 100);
    const second = makeEvent(4454, 101);
    const transfer = makeEvent(4455, 100);
    deliver('self.dm', first);
    deliver('self.dm', second);
    deliver('self.dm', transfer);
    await flush();

    expect(handlers.onKeyRequest).toHaveBeenCalledTimes(2);
    expect(handlers.onKeyTransfer).toHaveBeenCalledWith(transfer);
    warn.mockRestore();
  });

  it('applies a newer own 10050 to the relay_lists table and notifies; an equal replay does not', async () => {
    mockRelayListRows = [
      {
        accountPubkey: SELF,
        relayUrl: 'wss://old-dm.example',
        read: false,
        write: false,
        updatedAt: 100,
      },
    ];
    await startStream();

    const updated = makeEvent(10050, 200, [['relay', 'wss://new-dm.example']]);
    deliver('self.write', updated);
    await flush();

    expect(mockRelayListRows).toEqual([
      {
        accountPubkey: SELF,
        relayUrl: 'wss://new-dm.example',
        read: false,
        write: false,
        updatedAt: 200,
      },
    ]);
    expect(handlers.onOwnRelayListsChanged).toHaveBeenCalledTimes(1);

    // The subscribe-time replay of the same version must not retrigger.
    const replay = makeEvent(10050, 200, [['relay', 'wss://new-dm.example']]);
    deliver('self.discovery', replay);
    await flush();
    expect(handlers.onOwnRelayListsChanged).toHaveBeenCalledTimes(1);
    expect(mockRelayListRows).toHaveLength(1);
  });

  it('notifies on an own 10002 when no version is stored yet', async () => {
    await startStream();

    // No stored row: the write list is the discovery fallback, so a real 10002
    // existing at all is worth a rebuild.
    deliver('self.discovery', makeEvent(10002, 100, [['r', 'wss://x.example']]));
    await flush();
    expect(handlers.onOwnRelayListsChanged).toHaveBeenCalledTimes(1);
  });

  it('does not notify on the echo of the stored current 10002 (same created_at, same id)', async () => {
    const stored = makeEvent(10002, 100, [['r', 'wss://x.example']]);
    seedStoredReplaceable(stored);
    await startStream();

    // The subscribe-time replay of the version we published ourselves.
    deliver('self.discovery', { ...stored });
    await flush();
    expect(handlers.onOwnRelayListsChanged).not.toHaveBeenCalled();
  });

  it('notifies when the pushed 10002 is newer than the stale stored row (offline change)', async () => {
    // Another device edited our 10002 while we were offline; the local cache is
    // still within its TTL, so the pushed version IS the new one.
    seedStoredReplaceable(makeEvent(10002, 100, [['r', 'wss://old.example']]));
    await startStream();

    deliver('self.discovery', makeEvent(10002, 200, [['r', 'wss://new.example']]));
    await flush();
    expect(handlers.onOwnRelayListsChanged).toHaveBeenCalledTimes(1);
  });

  it('skips the private sets when no signer is available but still applies the public lists', async () => {
    mockGetSigner = jest.fn(async () => {
      throw new Error('account being torn down');
    });
    await startStream();

    deliver('self.write', makeEvent(30000, 100, [['d', 'psstpsst-muted']]));
    deliver('self.write', makeEvent(10063, 100));
    await flush();

    expect(mockApplyMutedEvent).not.toHaveBeenCalled();
    expect(mockApplyMediaServersEvent).toHaveBeenCalledTimes(1);
  });

  it('re-starting unsubscribes the old REQs and reopens on the fresh relay sets', async () => {
    const stream = await startStream();
    expect(mockSubscribeCalls).toHaveLength(3);
    const firstUnsubs = [...mockUnsubscribes];
    const staleOnEvent = mockSubscribeCalls.find((c) => c.label === 'self.dm')!.onEvent;

    mockLoadAccountDmRelays = jest.fn(async () => ['wss://dm-c.example']);
    await stream.start();

    for (const unsub of firstUnsubs) expect(unsub).toHaveBeenCalledTimes(1);
    expect(mockSubscribeCalls).toHaveLength(6);
    expect(mockSubscribeCalls.slice(3).map((c) => c.label)).toEqual([
      'self.dm',
      'self.write',
      'self.discovery',
    ]);
    expect(findSub('self.dm')!.relays).toEqual(['wss://dm-c.example']);

    // A late delivery through the closed subscription never reaches the handlers…
    staleOnEvent(makeEvent(4454, 100), 'wss://dm-a.example');
    await flush();
    expect(handlers.onKeyRequest).not.toHaveBeenCalled();

    // …while the reopened subscription delivers normally.
    deliver('self.dm', makeEvent(4454, 101));
    await flush();
    expect(handlers.onKeyRequest).toHaveBeenCalledTimes(1);
  });

  it('leaves no subscriptions behind when destroyed mid-start', async () => {
    let resolveDm!: (relays: string[]) => void;
    mockLoadAccountDmRelays = jest.fn(
      () =>
        new Promise<string[]>((resolve) => {
          resolveDm = resolve;
        }),
    );
    const stream = loadStream();
    stream.configure({
      accountPubkey: SELF,
      signAuth: jest.fn(),
      getSigner: mockGetSigner,
      handlers,
    });

    const started = stream.start();
    stream.destroy(); // lands while the relay sets are still resolving
    resolveDm(['wss://dm-a.example']);
    await started;

    expect(mockSubscribeCalls).toHaveLength(0);
  });

  it('destroy closes every subscription and stops delivering events', async () => {
    const stream = await startStream();

    // Enqueued but not yet flushed when destroy lands: must never run.
    deliver('self.dm', makeEvent(4455, 100));
    stream.destroy();

    expect(mockUnsubscribes).toHaveLength(3);
    for (const unsub of mockUnsubscribes) expect(unsub).toHaveBeenCalledTimes(1);

    deliver('self.dm', makeEvent(4454, 100));
    await flush();
    expect(handlers.onKeyTransfer).not.toHaveBeenCalled();
    expect(handlers.onKeyRequest).not.toHaveBeenCalled();
  });
});
