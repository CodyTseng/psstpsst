import { DISCOVERY_RELAYS, normalizeRelayUrl } from '@/lib/nostr/relay-url';
import type { Event } from 'nostr-tools';

import { relayPool, type QueryOpts } from '../relay-pool';
import { configurationPublishRelays, fetchReplaceable } from '../relay-router';
import { RelayQueryError } from '../relay-query-error';
import { queryMetadataRelay } from '../metadata-query';

jest.mock('../local-relay-settings', () => ({
  loadAccountDmRelays: async () => ['wss://dm.example/'],
}));
jest.mock('../routing-settings-edits', () => ({ readRoutingSettingsEdit: async () => undefined }));
jest.mock('@/db/client', () => ({ db: {} }));
jest.mock('../relay-pool', () => ({ relayPool: { query: jest.fn() } }));
jest.mock('../replaceable-events.service', () => ({
  markReplaceableFetched: jest.fn(), storeReplaceableEvent: jest.fn(),
  getReplaceableEvent: async () => ({ tags: [['r', 'wss://write.example/', 'write'], ['r', 'wss://read.example/', 'read'], ['r', 'wss://write.example/', 'write'], ['r', 'wss://unknown.example/', 'future-marker'], ['r', 'wss://empty-marker.example/', '']] }),
}));

const A = 'wss://a.example/';
const B = 'wss://b.example/';
const C = 'wss://c.example/';
const query = jest.mocked(relayPool.query);
let calls: Map<string, {
  options: QueryOpts;
  resolve: (events: Event[]) => void;
  reject: (error: Error) => void;
}>;

beforeEach(() => {
  calls = new Map();
  query.mockReset().mockImplementation((options) => new Promise((resolve, reject) => {
    calls.set(options.relays[0], { options, resolve, reject });
    options.abort?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }));
});

async function flushQueries() {
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
}

function event(author: string): Event {
  return { pubkey: author, kind: 0, created_at: 1, id: author, tags: [], sig: '', content: '' };
}

it('shares one subscription for profiles and commands with independent filters and results', async () => {
  const profile = fetchReplaceable([A], 0, 'alice');
  const commands = queryMetadataRelay(A, [
    { kinds: [31992], authors: ['alice'], limit: 256 },
    { kinds: [5], authors: ['alice'], limit: 256 },
  ]);
  await flushQueries();
  expect(query).toHaveBeenCalledTimes(1);
  expect(calls.get(A)!.options.filters).toEqual(expect.arrayContaining([
    { kinds: [0], authors: ['alice'] },
    { kinds: [31992], authors: ['alice'], limit: 256 },
    { kinds: [5], authors: ['alice'], limit: 256 },
  ]));
  const declaration = { ...event('alice'), kind: 31992, id: 'command', created_at: 99 };
  const deletion = { ...event('alice'), kind: 5, id: 'deletion' };
  calls.get(A)!.options.onEvent?.(declaration);
  calls.get(A)!.resolve([declaration, event('alice'), deletion, { ...declaration, pubkey: 'bob' }]);
  await expect(profile).resolves.toEqual(event('alice'));
  await expect(commands).resolves.toEqual([declaration, deletion]);
});

it('unions authors only for matching kinds and preserves per-author command limits', async () => {
  const profile = fetchReplaceable([A], 0, 'alice');
  const commands = ['bob', 'carol'].map(author => queryMetadataRelay(A, [
    { kinds: [31992], authors: [author], limit: 256 },
  ]));
  await flushQueries();
  expect(query).toHaveBeenCalledTimes(1);
  expect(calls.get(A)!.options.filters).toEqual(expect.arrayContaining([
    { kinds: [0], authors: ['alice'] },
    { kinds: [31992], authors: ['bob', 'carol'], limit: 512 },
  ]));
  calls.get(A)!.resolve([]);
  await profile;
  await Promise.all(commands);
});

it('waits for all relays and selects a newer event from the slower relay', async () => {
  const pending = fetchReplaceable([A, B], 0, 'alice');
  const completed = jest.fn();
  void pending.then(completed);
  await flushQueries();
  calls.get(A)!.resolve([event('alice')]);
  await flushQueries();
  await flushQueries();
  expect(completed).not.toHaveBeenCalled();
  const newer = { ...event('alice'), id: 'newer', created_at: 2 };
  calls.get(B)!.resolve([newer]);
  await expect(pending).resolves.toEqual(newer);
});

it('waits for each callers relay set without waiting for unrelated peers', async () => {
  const alice = fetchReplaceable([A, B], 0, 'alice');
  const bob = fetchReplaceable([B, C], 0, 'bob');
  const bobCompleted = jest.fn();
  void bob.then(bobCompleted);
  await flushQueries();
  expect(query).toHaveBeenCalledTimes(3);
  expect(calls.get(B)!.options.filters?.[0].authors).toEqual(['alice', 'bob']);
  calls.get(A)!.resolve([event('alice')]);
  calls.get(B)!.resolve([event('bob')]);
  await expect(alice).resolves.toEqual(event('alice'));
  expect(bobCompleted).not.toHaveBeenCalled();
  calls.get(C)!.resolve([]);
  await expect(bob).resolves.toEqual(event('bob'));
});

it('accepts an empty EOSE after another relay fails', async () => {
  const pending = fetchReplaceable([A, B], 0, 'alice');
  await flushQueries();
  calls.get(A)!.reject(new RelayQueryError([]));
  calls.get(B)!.resolve([]);
  await expect(pending).resolves.toBeNull();
});

it('rejects only after all target relays fail and permits retry', async () => {
  const pending = fetchReplaceable([A, B], 0, 'alice');
  const outcome = expect(pending).rejects.toBeInstanceOf(RelayQueryError);
  await flushQueries();
  calls.get(A)!.reject(new RelayQueryError([]));
  await flushQueries();
  calls.get(B)!.reject(new RelayQueryError([]));
  await outcome;
  const retry = fetchReplaceable([A, B], 0, 'alice');
  await flushQueries();
  expect(query).toHaveBeenCalledTimes(4);
  calls.get(A)!.resolve([]);
  calls.get(B)!.resolve([]);
  await expect(retry).resolves.toBeNull();
});

it.each(['query timed out', 'auth-required: sign in', 'rate-limited: slow down'])(
  'does not treat %s or an empty reply from a newly added relay as an established baseline',
  async reason => {
    const pending = fetchReplaceable([A, B], 10002, 'alice', { confirmedMissRelays: [A] });
    const outcome = expect(pending).rejects.toBeInstanceOf(RelayQueryError);
    await flushQueries();
    calls.get(A)!.options.onComplete?.({ status: 'complete', eosed: true, relays: [
      { url: A, status: 'eose', received: 0, reason },
    ] });
    calls.get(B)!.options.onComplete?.({ status: 'complete', eosed: true, relays: [
      { url: B, status: 'eose', received: 0 },
    ] });
    calls.get(A)!.resolve([]);
    calls.get(B)!.resolve([]);
    await outcome;
  },
);

it('accepts wire EOSE from a prior relay as a confirmed miss', async () => {
  const pending = fetchReplaceable([A, B], 10002, 'alice', { confirmedMissRelays: [A] });
  await flushQueries();
  calls.get(A)!.options.onComplete?.({ status: 'complete', eosed: true, relays: [
    { url: A, status: 'eose', received: 0 },
  ] });
  calls.get(A)!.resolve([]);
  calls.get(B)!.reject(new RelayQueryError([]));
  await expect(pending).resolves.toBeNull();
});

it('can merge a declaration observed even when the read fails before EOSE', async () => {
  const pending = fetchReplaceable([A, B], 10002, 'alice', { confirmedMissRelays: [A] });
  await flushQueries();
  const received = { ...event('alice'), kind: 10002 };
  calls.get(B)!.options.onEvent?.(received);
  calls.get(A)!.reject(new RelayQueryError([]));
  calls.get(B)!.reject(new RelayQueryError([]));
  await expect(pending).resolves.toEqual(received);
});

it('retains events already received from a slower relay when another sends empty EOSE', async () => {
  const pending = fetchReplaceable([A, B], 0, 'alice');
  await flushQueries();
  calls.get(B)!.options.onEvent?.(event('alice'));
  calls.get(A)!.resolve([]);
  calls.get(B)!.resolve([]);
  await expect(pending).resolves.toEqual(event('alice'));
});

it.each([0, 10002, 10050, 10063, 10030, 30000, 30030])('routes configuration kind %i to current write and discovery relays', async (kind) => {
  expect(await configurationPublishRelays({ ...event('alice'), kind }))
    .toEqual(['wss://write.example/', 'wss://empty-marker.example/', ...DISCOVERY_RELAYS.map(normalizeRelayUrl)]);
});

it('also routes key announcements to current inbox relays', async () => {
  expect(await configurationPublishRelays({ ...event('alice'), kind: 10044 }))
    .toEqual(['wss://dm.example/', 'wss://write.example/', 'wss://empty-marker.example/', ...DISCOVERY_RELAYS.map(normalizeRelayUrl)]);
});

it('publishes a write-relay edit to its old and new write relays plus discovery', async () => {
  expect(await configurationPublishRelays({ ...event('alice'), kind: 10002, tags: [['r', 'wss://new.example/', 'write']] }))
    .toEqual(['wss://write.example/', 'wss://empty-marker.example/', 'wss://new.example/', ...DISCOVERY_RELAYS.map(normalizeRelayUrl)]);
});
