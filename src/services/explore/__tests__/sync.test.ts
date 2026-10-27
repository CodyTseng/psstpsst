import type { NappData } from '../data';
import { NappSync } from '../sync';
import { localRelay } from '@/services/local-relay';
import type { Event } from 'nostr-tools';

jest.mock('@/services/local-relay', () => ({ localRelay: { add: jest.fn(async () => true) } }));

function setup() {
  const signal = new AbortController().signal;
  const query = jest.fn(async (_relays: string[], _filters: any[], _timeout?: number, _onEvent?: (event: Event) => void) => ({ events: [] as any[], incomplete: false }));
  const outboxRoutes = jest.fn(async (authors: string[]) => new Map([['wss://relay.example/', authors]]));
  const diagnostic = jest.fn();
  const routes = jest.fn(async () => ['wss://relay.example/']);
  const data = { signal, check: () => signal.throwIfAborted(), network: { routes, outboxRoutes }, query } as unknown as NappData;
  return { sync: new NappSync(data, diagnostic), query, routes, outboxRoutes, diagnostic };
}

beforeEach(() => jest.clearAllMocks());

it('syncs every author and kind without the former 16-item limits', async () => {
  const { sync, query } = setup();
  const authors = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(64, '0'));
  const kinds = Array.from({ length: 17 }, (_, i) => i + 100);
  await expect(sync.run(authors, kinds, { limit: 100000, until: 9999999999 })).resolves.toEqual({ success: true, newEvents: 0 });
  expect(query).toHaveBeenCalledTimes(authors.length * kinds.length);
  expect(query.mock.calls[0][1][0]).toMatchObject({ until: 9999999999, limit: 200 });
});

it('continues beyond 20 pages and 10000 events until the requested range is complete', async () => {
  const { sync, query } = setup();
  query.mockImplementation(async (_relays, filters) => {
    const cursor = filters[0].until;
    return { incomplete: false, events: cursor > 10000
      ? Array.from({ length: 200 }, (_, i) => ({ id: String(cursor - i - 1), created_at: cursor - i - 1 })) : [] };
  });
  await expect(sync.run(['a'.repeat(64)], [1], { since: 0, until: 20200 })).resolves.toEqual({ success: true, newEvents: 10200 });
  expect(query).toHaveBeenCalledTimes(52);
  expect(localRelay.add).toHaveBeenCalledTimes(10200);
});

it('treats a zero limit as an empty successful sync', async () => {
  const { sync, query } = setup();
  await expect(sync.run(['a'.repeat(64)], [1], { limit: 0 })).resolves.toEqual({ success: true, newEvents: 0 });
  expect(query).not.toHaveBeenCalled();
});

it('groups all 163 authors and seven kinds per relay instead of issuing 1141 queries', async () => {
  const { sync, query, outboxRoutes } = setup();
  const authors = Array.from({ length: 163 }, (_, i) => i.toString(16).padStart(64, '0')), kinds = [1, 1111, 1222, 1244, 6, 7, 16];
  outboxRoutes.mockResolvedValue(new Map([['wss://a.example/', authors], ['wss://b.example/', authors]]));
  await expect(sync.run(authors, kinds, { since: 100, until: 200 })).resolves.toEqual({ success: true, newEvents: 0 });
  expect(query).toHaveBeenCalledTimes(2);
  for (const [, filters] of query.mock.calls) expect(filters).toEqual([{ authors, kinds: [...kinds].sort((a,b)=>a-b), since: 100, until: 200, limit: 200 }]);
  await sync.run(authors, kinds, { since: 100, until: 200 });
  expect(query).toHaveBeenCalledTimes(2);
});

it.each([undefined, 10])('stores incoming history before EOSE with limit %s', async limit => {
  const { sync, query, diagnostic } = setup();
  let finish!: () => void;
  const eose = new Promise<void>(resolve => { finish = resolve; });
  const event = { id: 'early', created_at: 150 } as Event;
  query.mockImplementation(async (_relays, _filters, _timeout, onEvent) => {
    onEvent?.(event); await eose; return { events: [event], incomplete: false };
  });
  let completed = false;
  const pending = sync.run(['a'.repeat(64)], [1], { since: 100, until: 200, limit }).then(result => { completed = true; return result; });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(completed).toBe(false);expect(localRelay.add).toHaveBeenCalledWith(event);
  expect(diagnostic).toHaveBeenCalledWith('progress', expect.objectContaining({ newEvents: 1 }));
  finish(); await expect(pending).resolves.toEqual({ success: true, newEvents: 1 });
  expect(localRelay.add).toHaveBeenCalledTimes(1);
});

it('starts relays with more authors first and sends one combined filter per relay', async () => {
  const { sync, query, outboxRoutes } = setup();
  const authors = Array.from({ length: 20 }, (_, i) => i.toString(16).padStart(64, '0'));
  // Supply small groups first to verify scheduling does not rely on route-map order.
  outboxRoutes.mockResolvedValue(new Map(authors.map((_, i) => [`wss://relay-${i}.example/`, authors.slice(0, i + 1)])));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  query.mockImplementation(async () => { await gate; return { events: [], incomplete: false }; });
  const pending = sync.run(authors, [1, 6, 7], { since: 100, until: 200 });
  await new Promise(resolve => setTimeout(resolve, 0));
  try {
    expect(query).toHaveBeenCalledTimes(16);
    expect(query.mock.calls.map(([, filters]) => filters[0].authors.length)).toEqual(Array.from({ length: 16 }, (_, i) => 20 - i));
    for (const [, filters] of query.mock.calls) {
      expect(filters).toHaveLength(1);expect(filters[0].kinds).toEqual([1, 6, 7]);
    }
  } finally { release(); await pending; }
  expect(query.mock.calls.map(([, filters]) => filters[0].authors.length)).toEqual(Array.from({ length: 20 }, (_, i) => 20 - i));
});

it('also starts 16 concurrent tasks for limited sync calls', async () => {
  const { sync, query } = setup();
  const authors = Array.from({ length: 20 }, (_, i) => i.toString(16).padStart(64, '0'));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  query.mockImplementation(async () => { await gate; return { events: [], incomplete: false }; });
  const pending = sync.run(authors, [1], { limit: 10 });
  await new Promise(resolve => setTimeout(resolve, 0));
  try { expect(query).toHaveBeenCalledTimes(16); }
  finally { release(); await pending; }
  expect(query).toHaveBeenCalledTimes(20);
});

it('reserves the limited import budget before either relay can persist another event', async () => {
  const { sync, query, routes } = setup();
  routes.mockResolvedValue(['wss://a.example/', 'wss://b.example/']);
  let release!: () => void;
  const eose = new Promise<void>(resolve => { release = resolve; });
  query.mockImplementation(async ([relay], _filters, _timeout, onEvent) => {
    const event = { id: relay, created_at: 150 } as Event;
    onEvent?.(event);onEvent?.(event);
    await eose;return { events: [event], incomplete: false };
  });
  const pending = sync.run(['a'.repeat(64)], [1], { since: 100, until: 200, limit: 1 });
  await new Promise(resolve => setTimeout(resolve, 0));
  try { expect(localRelay.add).toHaveBeenCalledTimes(1); }
  finally { release(); }
  await expect(pending).resolves.toEqual({ success: true, newEvents: 1 });
  expect(localRelay.add).toHaveBeenCalledTimes(1);
});

it('applies limited admission separately to each author and kind', async () => {
  const { sync, query, routes } = setup();
  routes.mockResolvedValue(['wss://a.example/', 'wss://b.example/']);
  query.mockImplementation(async ([relay], [filter], _timeout, onEvent) => {
    const event = { id: `${filter.authors[0]}:${filter.kinds[0]}:${relay}`, created_at: 150 } as Event;
    onEvent?.(event);return { events: [event], incomplete: false };
  });
  await expect(sync.run(['a'.repeat(64),'b'.repeat(64)], [1,6], { limit: 1 })).resolves.toEqual({ success: true, newEvents: 4 });
  expect(localRelay.add).toHaveBeenCalledTimes(4);
});
