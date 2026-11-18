import { finalizeEvent, generateSecretKey, type Event, type Filter } from 'nostr-tools';
import { applicationTestDatabase } from '@/services/explore/testing/database';
import { DISCOVERY_RELAYS } from '@/lib/nostr/relay-url';
import { availableCommands, COMMAND_KIND } from '@/lib/nostr/commands';
import { getReplaceableEvent, invalidateReplaceableEvents, storeReplaceableEvent } from '@/services/relay/replaceable-events.service';
import { fetchReplaceable } from '@/services/relay/relay-router';
import { fetchCommandDeclarations, COMMAND_TTL_SECONDS } from '../command-discovery.service';

let mockFixture: ReturnType<typeof applicationTestDatabase>;
const mockQuery = jest.fn<Promise<Event[]>, [{ relays: string[]; filters?: Filter[] }]>();
const mockOutbox = jest.fn(async () => ({ write: ['wss://relay.example/'] }));
jest.mock('@/db/client', () => ({ get db() { return mockFixture.db; } }));
jest.mock('@/services/relay/relay-router', () => ({
  resolvePeerOutbox: (...args: []) => mockOutbox(...args),
  pickPeerRelays: jest.requireActual('@/services/relay/relay-router').pickPeerRelays,
  fetchReplaceable: jest.requireActual('@/services/relay/relay-router').fetchReplaceable,
}));
jest.mock('@/services/relay/relay-pool', () => ({ relayPool: { query: (...args: Parameters<typeof mockQuery>) => mockQuery(...args) } }));
let key = generateSecretKey();
let author: string;
let now: number;
function definition(time = 1, dTag = 'help', signingKey = key): Event {
  return finalizeEvent({ kind: COMMAND_KIND, content: '', created_at: time,
    tags: [['d', dTag], ['command', dTag || 'empty'], ['title', 'Help'], ['description', 'Show help'], ['s', 'kind:14']] }, signingKey);
}
function row(dTag = 'help', pubkey = author, kind = COMMAND_KIND) {
  const row = mockFixture.sqlite.prepare('SELECT event FROM replaceable_events WHERE pubkey=? AND kind=? AND d_tag=?')
    .get(pubkey, kind, dTag) as { event: string | null } | undefined;
  return row?.event ? JSON.parse(row.event) as Event : null;
}
function expire() { now += (COMMAND_TTL_SECONDS + 1) * 1000; }
beforeEach(() => {
  key = generateSecretKey(); author = definition().pubkey;
  now = 1_800_000_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  mockFixture = applicationTestDatabase();
  invalidateReplaceableEvents();
  mockQuery.mockReset(); mockQuery.mockResolvedValue([]);
  mockOutbox.mockReset(); mockOutbox.mockResolvedValue({ write: ['wss://relay.example/'] });
});
afterEach(() => { invalidateReplaceableEvents(); mockFixture.sqlite.close(); jest.restoreAllMocks(); });

test('queries all peer declarations from write, discovery and extra relays without d or list filters', async () => {
  mockOutbox.mockResolvedValue({ write: ['wss://write.example/', DISCOVERY_RELAYS[0]] });
  await fetchCommandDeclarations([author], ['wss://profile-hint.example/']);
  expect(mockQuery.mock.calls.map(([request]) => request.relays)).toEqual(
    [...new Set(['wss://write.example/', DISCOVERY_RELAYS[0], 'wss://profile-hint.example/', ...DISCOVERY_RELAYS])].map(relay => [relay]),
  );
  for (const [request] of mockQuery.mock.calls) expect(request.filters).toEqual([{ kinds: [31992], authors: [author] }]);
});

test('stores all signed definitions by coordinate, ignores forgeries and deduplicates concurrent discovery', async () => {
  const good = definition(), second = definition(1, 'ping'), other = definition(1, 'help', generateSecretKey());
  const forged = { ...JSON.parse(JSON.stringify(good)), content: 'forged' };
  mockQuery.mockResolvedValue([good, second, other, forged]);
  await Promise.all([fetchCommandDeclarations([author]), fetchCommandDeclarations([author])]);
  expect(row()?.id).toBe(good.id);
  expect(row('ping')?.id).toBe(second.id);
  expect(row('help', other.pubkey)).toBeNull();
  expect(mockQuery).toHaveBeenCalledTimes(DISCOVERY_RELAYS.length + 1);
  await fetchCommandDeclarations([author]);
  expect(mockQuery).toHaveBeenCalledTimes(DISCOVERY_RELAYS.length + 1);
});

test('profile and declaration requests share one subscription per relay', async () => {
  const profile = finalizeEvent({ kind: 0, content: '{}', created_at: 1, tags: [] }, key);
  mockQuery.mockResolvedValue([profile, definition()]);
  const [, resolved] = await Promise.all([
    fetchCommandDeclarations([author]), fetchReplaceable(['wss://relay.example/'], 0, author),
  ]);
  expect(resolved?.id).toBe(profile.id);
  const shared = mockQuery.mock.calls.map(([request]) => request).find(request =>
    request.filters?.some(filter => filter.kinds?.includes(0)),
  );
  expect(shared?.filters).toEqual(expect.arrayContaining([
    { kinds: [0], authors: [author] }, { kinds: [31992], authors: [author] },
  ]));
});

test('refreshing an author discovers new d values without an advertisement list', async () => {
  mockQuery.mockResolvedValue([definition()]);
  await fetchCommandDeclarations([author]);
  expire();
  const added = definition(2, 'bot:echo'), empty = definition(2, '');
  mockQuery.mockResolvedValue([definition(), added, empty]);
  await fetchCommandDeclarations([author]);
  expect(row('bot:echo')?.id).toBe(added.id);
  expect(row('')?.id).toBe(empty.id);
});

test('10992 and 10993 events do not control discovery or get modified', async () => {
  const list = finalizeEvent({ kind: 10993, content: '', created_at: 1, tags: [] }, key);
  await storeReplaceableEvent(list);
  mockQuery.mockResolvedValue([list, definition()]);
  await fetchCommandDeclarations([author]);
  expect(row()?.id).toBe(definition().id);
  expect(row('', author, 10993)?.id).toBe(list.id);
});

test('completed empty discovery is session-cached while failed outbox lookups remain retryable', async () => {
  mockQuery.mockImplementation(async request => {
    if (request.relays.includes('wss://relay.example/')) throw new Error('outbox offline');
    return [];
  });
  await expect(fetchCommandDeclarations([author])).rejects.toThrow();
  mockQuery.mockResolvedValue([]);
  await fetchCommandDeclarations([author]);
  const count = mockQuery.mock.calls.length;
  await fetchCommandDeclarations([author]);
  expect(mockQuery).toHaveBeenCalledTimes(count);
  expire();
  await fetchCommandDeclarations([author]);
  expect(mockQuery.mock.calls.length).toBeGreaterThan(count);
});

test('present coordinates stay newest-wins, complete empty results clear them, and invalid replacements retire commands', async () => {
  mockQuery.mockResolvedValue([definition(3)]);
  await fetchCommandDeclarations([author]);
  expire(); mockQuery.mockResolvedValue([definition()]);
  await fetchCommandDeclarations([author]); expect(row()?.created_at).toBe(3);
  expire(); mockQuery.mockResolvedValue([]);
  await fetchCommandDeclarations([author]); expect(row()).toBeNull();
  const invalid = finalizeEvent({ kind: COMMAND_KIND, content: '', created_at: 4,
    tags: [['d', 'help'], ['command', 'help']] }, key);
  expire(); mockQuery.mockResolvedValue([invalid]);
  await fetchCommandDeclarations([author]); expect(row()?.id).toBe(invalid.id);
  expect(availableCommands([row()!], { kind: 14, pubkey: author, tags: [] })).toEqual([]);
});

test('reconciles additions, updates and removals, invalidates mirrors and leaves other cache scopes untouched', async () => {
  const other = definition(1, 'foreign', generateSecretKey());
  const profile = finalizeEvent({ kind: 0, content: '{}', created_at: 1, tags: [] }, key);
  await storeReplaceableEvent(other);
  await storeReplaceableEvent(profile);
  mockQuery.mockResolvedValue([definition(), definition(1, 'gone')]);
  await fetchCommandDeclarations([author]);
  const goneKey = { pubkey: author, kind: COMMAND_KIND, dTag: 'gone' };
  expect(await getReplaceableEvent(goneKey)).not.toBeNull();
  expire();
  const updated = definition(2), added = definition(2, 'ping');
  mockQuery.mockResolvedValue([updated, added]);
  await fetchCommandDeclarations([author]);
  expect(row()?.id).toBe(updated.id);
  expect(row('ping')?.id).toBe(added.id);
  expect(row('gone')).toBeNull();
  expect(await getReplaceableEvent(goneKey)).toBeNull();
  expect(row('foreign', other.pubkey)?.id).toBe(other.id);
  expect(row('', author, 0)?.id).toBe(profile.id);
});

test('partial write-relay failure preserves old commands and permits an immediate full retry', async () => {
  mockQuery.mockResolvedValue([definition()]);
  await fetchCommandDeclarations([author]);
  expire();
  mockOutbox.mockResolvedValue({ write: ['wss://relay.example/', 'wss://second.example/'] });
  const added = definition(2, 'ping');
  mockQuery.mockImplementation(async request => {
    if (request.relays.includes('wss://second.example/')) throw new Error('offline');
    return [added];
  });
  await expect(fetchCommandDeclarations([author])).rejects.toThrow();
  expect(row()).not.toBeNull();
  expect(row('ping')?.id).toBe(added.id);
  mockQuery.mockResolvedValue([added]);
  await fetchCommandDeclarations([author]);
  expect(row()).toBeNull();
  expect(row('ping')?.id).toBe(added.id);
});

test('an unavailable auxiliary index does not veto a complete write-relay snapshot', async () => {
  mockQuery.mockResolvedValue([definition()]);
  await fetchCommandDeclarations([author]);
  expire();
  mockQuery.mockImplementation(async request => {
    if (request.relays.includes(DISCOVERY_RELAYS[0])) throw new Error('index offline');
    return [];
  });
  await fetchCommandDeclarations([author]);
  expect(row()).toBeNull();
});

test('without known write relays, an incomplete fallback query cannot remove commands', async () => {
  mockQuery.mockResolvedValue([definition()]);
  await fetchCommandDeclarations([author]);
  expire();
  mockOutbox.mockResolvedValue({ write: [] });
  mockQuery.mockImplementation(async request => {
    if (request.relays.includes(DISCOVERY_RELAYS[0])) throw new Error('offline');
    return [];
  });
  await expect(fetchCommandDeclarations([author])).rejects.toThrow();
  expect(row()).not.toBeNull();
});

test('a failed reconciliation rolls back deletions and remains retryable', async () => {
  mockQuery.mockResolvedValue([definition()]);
  await fetchCommandDeclarations([author]);
  expire();
  mockFixture.sqlite.exec(`CREATE TRIGGER fail_command_insert BEFORE INSERT ON replaceable_events
    WHEN NEW.pubkey='${author}' AND NEW.kind=31992 AND NEW.d_tag='ping'
    BEGIN SELECT RAISE(ABORT, 'test snapshot failure'); END`);
  const added = definition(2, 'ping');
  mockQuery.mockResolvedValue([added]);
  await expect(fetchCommandDeclarations([author])).rejects.toThrow();
  expect(row()).not.toBeNull();
  expect(row('ping')).toBeNull();
  mockFixture.sqlite.exec('DROP TRIGGER fail_command_insert');
  await fetchCommandDeclarations([author]);
  expect(row()).toBeNull();
  expect(row('ping')?.id).toBe(added.id);
});

test('bulk peer requests coalesce by relay and never mix their cached authors', async () => {
  const other = definition(1, 'ping', generateSecretKey());
  mockQuery.mockResolvedValue([definition(), other]);
  await fetchCommandDeclarations([author, other.pubkey]);
  expect(mockQuery).toHaveBeenCalledTimes(DISCOVERY_RELAYS.length + 1);
  expect(row('help', author)?.pubkey).toBe(author);
  expect(row('ping', other.pubkey)?.pubkey).toBe(other.pubkey);
});
