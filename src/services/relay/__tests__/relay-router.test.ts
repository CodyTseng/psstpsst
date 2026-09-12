import { DISCOVERY_RELAYS, normalizeRelayUrl } from '@/lib/nostr/relay-url';
import type { Event } from 'nostr-tools';

import { relayPool, type QueryOpts } from '../relay-pool';
import { configurationPublishRelays, fetchReplaceable } from '../relay-router';
import { RelayQueryError } from '../relay-query-error';

jest.mock('../local-relay-settings', () => ({
  loadAccountDmRelays: async () => ['wss://dm.example'],
}));
jest.mock('@/db/client', () => ({ db: {} }));
jest.mock('../relay-pool', () => ({ relayPool: { query: jest.fn() } }));
jest.mock('../replaceable-events.service', () => ({
  markReplaceableFetched: jest.fn(), storeReplaceableEvent: jest.fn(),
  getReplaceableEvent: async () => ({ tags: [['r', 'wss://write.example', 'write'], ['r', 'wss://read.example', 'read'], ['r', 'wss://write.example/', 'write'], ['r', 'wss://unknown.example', 'future-marker'], ['r', 'wss://empty-marker.example', '']] }),
}));

const A = 'wss://a.example';
const B = 'wss://b.example';
const C = 'wss://c.example';
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

function event(author: string): Event {
  return { pubkey: author, kind: 0, created_at: 1, id: author, tags: [], sig: '', content: '' };
}

it('waits for all relays and selects a newer event from the slower relay', async () => {
  const pending = fetchReplaceable([A, B], 0, 'alice');
  const completed = jest.fn();
  void pending.then(completed);
  await Promise.resolve();
  calls.get(A)!.resolve([event('alice')]);
  await Promise.resolve();
  await Promise.resolve();
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
  await Promise.resolve();
  expect(query).toHaveBeenCalledTimes(3);
  expect(calls.get(B)!.options.filter?.authors).toEqual(['alice', 'bob']);
  calls.get(A)!.resolve([event('alice')]);
  calls.get(B)!.resolve([event('bob')]);
  await expect(alice).resolves.toEqual(event('alice'));
  expect(bobCompleted).not.toHaveBeenCalled();
  calls.get(C)!.resolve([]);
  await expect(bob).resolves.toEqual(event('bob'));
});

it('accepts an empty EOSE after another relay fails', async () => {
  const pending = fetchReplaceable([A, B], 0, 'alice');
  await Promise.resolve();
  calls.get(A)!.reject(new RelayQueryError([]));
  calls.get(B)!.resolve([]);
  await expect(pending).resolves.toBeNull();
});

it('rejects only after all target relays fail and permits retry', async () => {
  const pending = fetchReplaceable([A, B], 0, 'alice');
  const outcome = expect(pending).rejects.toBeInstanceOf(RelayQueryError);
  await Promise.resolve();
  calls.get(A)!.reject(new RelayQueryError([]));
  await Promise.resolve();
  calls.get(B)!.reject(new RelayQueryError([]));
  await outcome;
  const retry = fetchReplaceable([A, B], 0, 'alice');
  await Promise.resolve();
  expect(query).toHaveBeenCalledTimes(4);
  calls.get(A)!.resolve([]);
  calls.get(B)!.resolve([]);
  await expect(retry).resolves.toBeNull();
});

it('retains events already received from a slower relay when another sends empty EOSE', async () => {
  const pending = fetchReplaceable([A, B], 0, 'alice');
  await Promise.resolve();
  calls.get(B)!.options.onEvent?.(event('alice'));
  calls.get(A)!.resolve([]);
  calls.get(B)!.resolve([]);
  await expect(pending).resolves.toEqual(event('alice'));
});

it.each([0, 10002, 10050, 10063, 10030, 30000, 30030])('routes configuration kind %i to current write and discovery relays', async (kind) => {
  expect(await configurationPublishRelays({ ...event('alice'), kind }))
    .toEqual(['wss://write.example', 'wss://empty-marker.example', ...DISCOVERY_RELAYS.map(normalizeRelayUrl)]);
});

it('also routes key announcements to current inbox relays', async () => {
  expect(await configurationPublishRelays({ ...event('alice'), kind: 10044 }))
    .toEqual(['wss://dm.example', 'wss://write.example', 'wss://empty-marker.example', ...DISCOVERY_RELAYS.map(normalizeRelayUrl)]);
});
