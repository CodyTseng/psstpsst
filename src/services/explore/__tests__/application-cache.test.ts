import { finalizeEvent, generateSecretKey } from 'nostr-tools';
import type { Event } from 'nostr-tools';
import type { applicationTestDatabase } from '../testing/database';

let mockDatabase: ReturnType<typeof applicationTestDatabase> | undefined;
const mockQuery = jest.fn();
jest.mock('@/db/client', () => mockDatabase ??= jest.requireActual('../testing/database').applicationTestDatabase());
jest.mock('@/platform', () => ({ platform: { appState: { currentState: () => 'active' } } }));
jest.mock('@/services/napplet/network', () => ({ NappletNetwork: jest.fn(() => ({ query: mockQuery,
  routes: async () => ['wss://write.example/'], mediaServers: async () => [], destroy: () => {} })) }));
jest.mock('@/services/relay/relay-pool', () => ({ relayPool: { query: jest.fn() } }));

const secret = generateSecretKey();
const event = (kind = 35130, at = 1, title = 'Notes') => finalizeEvent({ kind, created_at: at, content: kind === 5129 ? 'Immutable application' : '',
  tags: kind === 5129 ? [['x', 'a'.repeat(64)], ['title', title]] : [['d', 'notes'], ['title', title], ['path', '/index.html', 'a'.repeat(64)]] }, secret);
const modules = () => ({ ...jest.requireActual('../application-cache'), ...jest.requireActual('../application-metadata') }) as
  typeof import('../application-cache') & typeof import('../application-metadata');
beforeEach(() => { jest.resetModules(); mockDatabase = undefined; mockQuery.mockReset(); });
afterEach(() => mockDatabase?.sqlite.close());

it('persists a replaceable app once per coordinate and reuses it after process caches reset', async () => {
  const cache = modules(), app = cache.parseApplicationEvent(event());
  await cache.cacheApplicationEvent(app);
  jest.resetModules();
  const next = modules();
  const resolved = await next.resolveApplicationMetadata('account', { ...app, manifest: undefined }, new AbortController().signal);
  expect(resolved.manifest?.id).toBe(app.manifest!.id);
  expect(mockQuery).not.toHaveBeenCalled();
  expect(mockDatabase!.sqlite.prepare('SELECT count(*) AS n FROM replaceable_events').get()).toEqual({ n: 1 });
});

it('queries current database metadata on reopening even when no list consumed a notification', async () => {
  const cache = modules(), old = cache.parseApplicationEvent(event()), updated = event(35130, 2, 'New Notes');
  const otherEvent = (at: number) => finalizeEvent({ kind: 35130, created_at: at, content: '',
    tags: [['d', 'calendar'], ['title', `Calendar ${at}`], ['path', '/index.html', 'a'.repeat(64)]] }, secret);
  const other = cache.parseApplicationEvent(otherEvent(1)), otherUpdated = otherEvent(2);
  await cache.cacheApplicationEvent(old); await cache.cacheApplicationEvent(other);
  await cache.readApplicationCache([old, other]);
  const update = mockDatabase!.sqlite.prepare('UPDATE replaceable_events SET event=?,created_at=? WHERE pubkey=? AND kind=? AND d_tag=?');
  update.run(JSON.stringify(updated), updated.created_at, updated.pubkey, updated.kind, 'notes');
  update.run(JSON.stringify(otherUpdated), otherUpdated.created_at, otherUpdated.pubkey, otherUpdated.kind, 'calendar');
  expect((await cache.readChangedApplicationMetadata(old))?.manifest?.id).toBe(updated.id);
  expect((await cache.readApplicationCache([other])).get(other.key)?.manifest?.id).toBe(otherUpdated.id);
  expect(mockQuery).not.toHaveBeenCalled();
});

it('persists observed sources, merges identical releases and resets sources when the coordinate changes version', async () => {
  const cache = modules(), old = cache.parseApplicationEvent(event());
  const a = 'wss://actual-a.example/', b = 'wss://actual-b.example/';
  await Promise.all([cache.cacheApplicationEvent({ ...old, eventRelays: [a] }),
    cache.cacheApplicationEvent({ ...old, eventRelays: [b, a] })]);
  jest.resetModules();
  const next = modules();
  const restored = (await next.readApplicationCache([old])).get(old.key)!;
  expect(new Set(restored.eventRelays)).toEqual(new Set([a, b]));
  const { applicationCopyAddress } = jest.requireActual('../model') as typeof import('../model');
  const { decode } = jest.requireActual('nostr-tools/nip19') as typeof import('nostr-tools/nip19');
  expect(decode(applicationCopyAddress(restored)).data).toMatchObject({ relays: expect.arrayContaining([a, b]) });
  const newer = next.parseApplicationEvent(event(35130, 2, 'New release'));
  await next.cacheApplicationEvent({ ...newer, eventRelays: [b] });
  await next.cacheApplicationEvent({ ...old, eventRelays: [a] });
  expect((await next.readApplicationCache([old])).get(old.key)?.eventRelays).toEqual([b]);
});

it('saves only the relay that returned the event, rather than every queried relay', async () => {
  const cache = modules(), manifest = event();
  const app = cache.parseApplicationEvent(manifest), actual = 'wss://actual.example/';
  mockQuery.mockResolvedValue({ events: [manifest], eventRelays: new Map([[manifest.id, [actual]]]), incomplete: false });
  const resolved = await cache.resolveApplicationMetadata('account', { ...app, manifest: undefined }, new AbortController().signal);
  expect(resolved.eventRelays).toEqual([actual]);
  jest.resetModules();
  expect((await modules().readApplicationCache([app])).get(app.key)?.eventRelays).toEqual([actual]);
});

it('records the verified relay source during a stale refresh', async () => {
  const cache = modules(), app = cache.parseApplicationEvent(event()), newer = event(35130, 2, 'Updated');
  await cache.cacheApplicationEvent({ ...app, eventRelays: ['wss://old.example/'] });
  mockDatabase!.sqlite.exec('UPDATE replaceable_events SET fetched_at=0');
  jest.requireActual('@/services/relay/replaceable-events.service').invalidateReplaceableEvents();
  const actual = 'wss://fresh.example/';
  mockQuery.mockResolvedValue({ events: [newer], eventRelays: new Map([[newer.id, [actual]]]), incomplete: false });
  await cache.refreshApplicationMetadata('account', [app], new AbortController().signal);
  const restored = (await cache.readApplicationCache([app])).get(app.key)!;
  expect(restored.manifest?.id).toBe(newer.id);
  expect(restored.eventRelays).toEqual([actual]);
});

it('persists immutable event sources alongside the event ID', async () => {
  const cache = modules(), app = cache.parseApplicationEvent(event(5129)), actual = 'wss://actual.example/';
  await cache.cacheApplicationEvent({ ...app, eventRelays: [actual] });
  jest.resetModules();
  const restored = (await modules().readApplicationCache([app])).get(app.key)!;
  expect(restored.eventRelays).toEqual([actual]);
  expect(restored.release?.eventRelays).toEqual([actual]);
});

it.each([0, 1])('isolates consumer %s cancellation from another metadata consumer', async canceled => {
  const cache = modules(), manifest = event(), app = { ...cache.parseApplicationEvent(manifest), manifest: undefined };
  const lives = [new AbortController(), new AbortController()];
  let finish!: (value: { events: Event[]; incomplete: boolean }) => void;
  mockQuery.mockImplementationOnce((_relays, _filters, signal: AbortSignal) => new Promise((resolve, reject) => {
    finish = resolve; signal.addEventListener('abort', () => reject(new Error('session-closed')), { once: true });
  }));
  const consumers = lives.map(life => cache.resolveApplicationMetadata('account', app, life.signal));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(mockQuery).toHaveBeenCalledTimes(1);
  const canceledResult = expect(consumers[canceled]).rejects.toMatchObject({ name: 'AbortError' });
  lives[canceled].abort();
  await canceledResult;
  expect((mockQuery.mock.calls[0][2] as AbortSignal).aborted).toBe(false);
  finish({ events: [manifest], incomplete: false });
  await expect(consumers[1 - canceled]).resolves.toMatchObject({ manifest: { id: manifest.id } });
});

it('cancels the shared network only after every consumer leaves and allows a fresh request', async () => {
  const cache = modules(), manifest = event(), app = { ...cache.parseApplicationEvent(manifest), manifest: undefined };
  mockQuery.mockImplementationOnce((_relays, _filters, signal: AbortSignal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('session-closed')), { once: true });
  }));
  const lives = [new AbortController(), new AbortController()];
  const consumers = lives.map(life => cache.resolveApplicationMetadata('account', app, life.signal));
  const results = Promise.allSettled(consumers);
  await new Promise(resolve => setTimeout(resolve, 0));
  lives[0].abort(); lives[1].abort();
  expect((mockQuery.mock.calls[0][2] as AbortSignal).aborted).toBe(true);
  expect((await results).every(result => result.status === 'rejected')).toBe(true);
  mockQuery.mockResolvedValueOnce({ events: [manifest], incomplete: false });
  await expect(cache.resolveApplicationMetadata('account', app, new AbortController().signal)).resolves.toMatchObject({ manifest: { id: manifest.id } });
  expect(mockQuery).toHaveBeenCalledTimes(2);
});

it('returns the cached release while a stale coordinate refreshes and replaces only its latest event', async () => {
  const cache = modules(), old = cache.parseApplicationEvent(event()), updated = event(35130, 2, 'New Notes');
  await cache.cacheApplicationEvent(old);
  mockDatabase!.sqlite.exec('UPDATE replaceable_events SET fetched_at=0');
  jest.requireActual('@/services/relay/replaceable-events.service').invalidateReplaceableEvents();
  let finish!: (value: { events: Event[]; incomplete: boolean }) => void;
  mockQuery.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const seen = jest.fn(), stop = cache.subscribeApplicationMetadata(seen);
  const life = new AbortController();
  const result = await cache.resolveApplicationMetadata('account', old, life.signal);
  expect(result.manifest!.id).toBe(old.manifest!.id);
  const refresh = cache.refreshApplicationMetadata('account', [old], life.signal);
  await new Promise(resolve => setTimeout(resolve, 0));
  finish({ events: [updated], incomplete: false });
  await refresh;
  expect((await cache.readApplicationCache([old])).get(old.key)?.manifest?.id).toBe(updated.id);
  expect(seen).toHaveBeenCalledWith(expect.objectContaining({ key: old.key, title: 'New Notes' }));
  expect(mockDatabase!.sqlite.prepare('SELECT count(*) AS n FROM replaceable_events').get()).toEqual({ n: 1 });
  stop(); life.abort();
});

it('renews a completed unchanged lookup without discarding cached content', async () => {
  const cache = modules(), app = cache.parseApplicationEvent(event());
  await cache.cacheApplicationEvent(app);
  mockDatabase!.sqlite.exec('UPDATE replaceable_events SET fetched_at=0');
  jest.requireActual('@/services/relay/replaceable-events.service').invalidateReplaceableEvents();
  mockQuery.mockResolvedValue({ events: [], incomplete: false });
  const changed = jest.fn(), stop = cache.subscribeApplicationMetadata(changed);
  await cache.refreshApplicationMetadata('account', [app], new AbortController().signal);
  expect((mockDatabase!.sqlite.prepare('SELECT fetched_at FROM replaceable_events').get() as { fetched_at: number }).fetched_at).toBeGreaterThan(0);
  expect((await cache.readApplicationCache([app])).get(app.key)?.manifest?.id).toBe(app.manifest!.id);
  expect(changed).not.toHaveBeenCalled(); stop();
});

it('leaves failed lookups stale and keeps the old release usable', async () => {
  const cache = modules(), app = cache.parseApplicationEvent(event());
  await cache.cacheApplicationEvent(app);
  mockDatabase!.sqlite.exec('UPDATE replaceable_events SET fetched_at=0');
  jest.requireActual('@/services/relay/replaceable-events.service').invalidateReplaceableEvents();
  mockQuery.mockResolvedValue({ events: [], incomplete: true });
  await expect(cache.refreshApplicationMetadata('account', [app], new AbortController().signal)).rejects.toThrow();
  expect(mockDatabase!.sqlite.prepare('SELECT fetched_at FROM replaceable_events').get()).toEqual({ fetched_at: 0 });
  expect((await cache.readApplicationCache([app])).get(app.key)?.manifest?.id).toBe(app.manifest!.id);
});

it('stores immutable kind-5129 apps only in the shared event-ID cache', async () => {
  const cache = modules(), app = cache.parseApplicationEvent(event(5129));
  await cache.cacheApplicationEvent(app);
  expect((await cache.readApplicationCache([app])).get(app.key)?.manifest?.id).toBe(app.manifest!.id);
  expect(mockDatabase!.sqlite.prepare('SELECT id FROM cached_events').get()).toEqual({ id: app.manifest!.id });
  expect(mockDatabase!.sqlite.prepare('SELECT count(*) AS n FROM replaceable_events').get()).toEqual({ n: 0 });
});

it('uses the lower event ID for equal timestamps and rejects forged cache inputs', async () => {
  const cache = modules(), a = event(35130, 10, 'A'), b = event(35130, 10, 'B');
  const [winner, loser] = [a, b].sort((x, y) => x.id.localeCompare(y.id));
  await cache.cacheApplicationEvent(cache.parseApplicationEvent(loser));
  await cache.cacheApplicationEvent(cache.parseApplicationEvent(winner));
  const row = mockDatabase!.sqlite.prepare('SELECT event FROM replaceable_events').get() as { event: string };
  expect(JSON.parse(row.event).id).toBe(winner.id);
  expect(() => cache.parseApplicationEvent({ ...winner, content: 'forged' })).toThrow();
});

it('bounds ID-cache growth without evicting a favorited immutable application', async () => {
  const cache = modules(), pinned = event(5129), next = event(5129, 2, 'Next');
  await cache.cacheApplicationEvent(cache.parseApplicationEvent(pinned));
  const sqlite = mockDatabase!.sqlite;
  sqlite.prepare('INSERT INTO private_list_sync_state(account_pubkey,kind,d_tag,snapshot) VALUES (?,?,?,?)')
    .run('account', 30267, 'psstpsst-favorites', JSON.stringify({ eventId: 'favorites', tags: [['e', pinned.id]] }));
  sqlite.exec('UPDATE cached_events SET fetched_at=0');
  const insert = sqlite.prepare('INSERT INTO cached_events(id,event,fetched_at) VALUES (?,?,?)');
  for (let index = 0; index < 2050; index++) {
    const id = index.toString(16).padStart(64, '0');
    insert.run(id, JSON.stringify({ ...pinned, id }), index + 1);
  }
  await cache.cacheApplicationEvent(cache.parseApplicationEvent(next));
  expect(sqlite.prepare('SELECT count(*) AS n FROM cached_events').get()).toEqual({ n: 2049 });
  expect(sqlite.prepare('SELECT id FROM cached_events WHERE id=?').get(pinned.id)).toEqual({ id: pinned.id });
});

it('keeps favorited coordinates while bounding unrelated replaceable application cache rows', async () => {
  const cache = modules(), pinned = event();
  await cache.cacheApplicationEvent(cache.parseApplicationEvent(pinned));
  const sqlite = mockDatabase!.sqlite;
  sqlite.prepare('INSERT INTO private_list_sync_state(account_pubkey,kind,d_tag,draft,dirty) VALUES (?,?,?,?,1)')
    .run('account', 30267, 'psstpsst-favorites', JSON.stringify([['a', `35130:${pinned.pubkey}:notes`]]));
  sqlite.exec('UPDATE replaceable_events SET fetched_at=0');
  const insert = sqlite.prepare('INSERT INTO replaceable_events(pubkey,kind,d_tag,event,created_at,fetched_at) VALUES (?,35130,?,?,1,?)');
  for (let index = 0; index < 2050; index++) insert.run(pinned.pubkey, `other-${index}`, JSON.stringify(pinned), index + 1);
  const next = finalizeEvent({ kind: 35130, created_at: 2, content: '', tags: [['d', 'new'], ['path', '/index.html', 'b'.repeat(64)]] }, secret);
  await cache.cacheApplicationEvent(cache.parseApplicationEvent(next));
  expect(sqlite.prepare('SELECT count(*) AS n FROM replaceable_events').get()).toEqual({ n: 2049 });
  const stored = sqlite.prepare('SELECT event FROM replaceable_events WHERE d_tag=?').get('notes') as { event: string };
  expect(JSON.parse(stored.event).id).toBe(pinned.id);
});

it('restores a newly favorited coordinate evicted from disk without falsely renewing its freshness', async () => {
  const cache = modules(), app = cache.parseApplicationEvent(event());
  await cache.cacheApplicationEvent(app);
  mockDatabase!.sqlite.exec('UPDATE replaceable_events SET fetched_at=0');
  jest.requireActual('@/services/relay/replaceable-events.service').invalidateReplaceableEvents();
  await cache.readApplicationCache([app]);
  mockDatabase!.sqlite.exec('DELETE FROM replaceable_events');
  await cache.cacheApplicationEvent(app, { retain: true });
  const row = mockDatabase!.sqlite.prepare('SELECT event,fetched_at FROM replaceable_events').get() as { event: string; fetched_at: number };
  expect(JSON.parse(row.event).id).toBe(app.manifest!.id);
  expect(row.fetched_at).toBe(0);
});
