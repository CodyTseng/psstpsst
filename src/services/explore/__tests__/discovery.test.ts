import { finalizeEvent, generateSecretKey } from 'nostr-tools';
import { discoveryEntries, ApplicationDiscovery } from '../discovery';
import { queryApplicationCatalogue } from '../catalogue-relays';
import { NappletNetwork } from '@/services/napplet/network';

jest.mock('@/services/napplet/network', () => ({ NappletNetwork: jest.fn() }));
const secret = generateSecretKey();
const manifest = (kind: number, created_at = 1) => finalizeEvent({ kind, created_at, content: 'Description',
  tags: [...(kind === 15128 ? [] : [['d', 'demo']]), ['title', 'Demo'], ['path', '/index.html', 'a'.repeat(64)], ['server', 'https://media.example/']] }, secret);

it('verifies manifests, deduplicates addresses and keeps the newest version', async () => {
  const older = manifest(35130), newer = manifest(35130, 2), named = manifest(35128), root = manifest(15128);
  const apps = await discoveryEntries([older, newer, named, root, { ...newer, content: 'forged' }, manifest(1)]);
  expect(apps).toHaveLength(3);
  expect(apps[0].manifest?.id).toBe(newer.id);
  expect(apps.every(app => app.lastUsedAt === null && app.desktopPosition === null)).toBe(true);
  expect(apps.map(app => app.kind).sort()).toEqual(['napp', 'nsite', 'nsite']);
});

it.each([5129,15129,35129])('discovers napplet kind %s with its verified release',async kind=>{
  const event=finalizeEvent({kind,created_at:1,content:'A mini app',tags:[...(kind===35129?[['d','demo']]:[]),['x','a'.repeat(64)],['title','Mini app'],['server','https://media.example/']]},secret);
  const apps=await discoveryEntries([event]);
  expect(apps).toHaveLength(1);
  expect(apps[0].kind).toBe('napplet');
  expect(apps[0].release?.event.id).toBe(event.id);
});

it('queries each format only on its dedicated relays and rejects results from the wrong source', async () => {
  const napp = manifest(35130), nsite = manifest(35128);
  const query = jest.fn().mockResolvedValue({ events: [napp, nsite], incomplete: false });
  const result = await queryApplicationCatalogue({ query } as unknown as NappletNetwork);
  expect(query.mock.calls).toEqual([
    [['wss://relay.nostrapps.com/'], [{ kinds: [35130], limit: 200 }]],
    [['wss://relay.napplet.soy/'], [{ kinds: [5129, 15129, 35129], limit: 200 }]],
    [['wss://relay.nsite.lol/', 'wss://relay.nosto.re/'], [{ kinds: [15128, 35128], limit: 200 }]],
  ]);
  expect(result).toEqual({ events: [napp, nsite], incomplete: false });
});

it.each(['reject', 'error', 'incomplete'])('retains other formats when one catalogue source reports %s', async failure => {
  const napp = manifest(35130), nsite = manifest(35128);
  const query = jest.fn().mockResolvedValueOnce({ events: [napp], incomplete: false });
  if (failure === 'reject') query.mockRejectedValueOnce(new Error('offline'));
  else query.mockResolvedValueOnce({ events: [], incomplete: true, ...(failure === 'error' ? { error: 'network-error' } : {}) });
  query.mockResolvedValueOnce({ events: [nsite], incomplete: false });
  expect(await queryApplicationCatalogue({ query } as unknown as NappletNetwork))
    .toEqual({ events: [napp, nsite], incomplete: true });
  expect(query).toHaveBeenCalledTimes(3);
});

it('reports total catalogue failure without querying fallback relays', async () => {
  const query = jest.fn().mockRejectedValue(new Error('offline'));
  await expect(queryApplicationCatalogue({ query } as unknown as NappletNetwork)).rejects.toThrow('catalogue-unavailable');
  expect(query).toHaveBeenCalledTimes(3);
});


const uniqueManifest = (kind: number, time: number, name = `app-${time}`) => finalizeEvent({ kind,
  created_at: time, content: 'Description', tags: [['d', name], ...(kind === 35129 ? [['x', 'a'.repeat(64)]] : [['path', '/index.html', 'a'.repeat(64)]])] }, secret);
const nappRelay = 'wss://relay.nostrapps.com/';
const nappletRelay = 'wss://relay.napplet.soy/';
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function setup(data: Record<string, ReturnType<typeof manifest>[]>) {
  const query = jest.fn(async ([relay]: string[], [filter]: { kinds: number[]; limit: number; until?: number }[]) => ({
    events: (data[relay] ?? []).filter(event => filter.kinds.includes(event.kind) &&
      (filter.until === undefined || event.created_at <= filter.until))
      .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id)).slice(0, filter.limit),
    incomplete: false,
  }));
  const destroy = jest.fn();
  jest.mocked(NappletNetwork).mockImplementation(() => ({ query, destroy }) as unknown as NappletNetwork);
  return { query, destroy, discovery: new ApplicationDiscovery() };
}

it('reveals 20 entries at a time from memory before requesting the next relay page', async () => {
  const events = Array.from({ length: 225 }, (_, i) => uniqueManifest(35130, 1000 - i));
  const { query, discovery } = setup({ [nappRelay]: events });
  await discovery.load('account');
  expect(query).toHaveBeenCalledTimes(2);
  expect(query.mock.calls[0].slice(0, 2)).toEqual([[nappRelay], [{ kinds: [35130], limit: 200 }]]);
  expect(query.mock.calls[1][1]).toEqual([{ kinds: [5129, 15129, 35129], limit: 200 }]);

  expect(discovery.store.getState().visibleEntries).toHaveLength(20);
  expect(discovery.store.getState().entries).toHaveLength(200);
  for (let i = 0; i < 9; i++) await discovery.loadMore('account');
  expect(discovery.store.getState().visibleEntries).toHaveLength(200);
  expect(query).toHaveBeenCalledTimes(2);
  await discovery.loadMore('account');
  expect(query.mock.calls[2].slice(0, 2)).toEqual([[nappRelay], [{ kinds: [35130], limit: 200, until: 801 }]]);
  expect(discovery.store.getState().visibleEntries).toHaveLength(220);
  await discovery.loadMore('account');
  expect(discovery.store.getState()).toMatchObject({ hasMore: false, error: false });
  expect(discovery.store.getState().visibleEntries.map(app => app.manifest!.id)).toEqual(events.map(event => event.id));
  const requests = query.mock.calls.length;
  await discovery.loadMore('account');
  expect(query).toHaveBeenCalledTimes(requests);
});

it('merges independent relay histories in descending time order without skipping a busy source', async () => {
  const busy = Array.from({ length: 210 }, (_, i) => uniqueManifest(35130, 1000 - i));
  const older = Array.from({ length: 25 }, (_, i) => uniqueManifest(35129, 500 - i));
  const { discovery } = setup({ [nappRelay]: busy, [nappletRelay]: older });
  await discovery.load('account');
  for (let i = 0; i < 14 && discovery.store.getState().hasMore; i++) await discovery.loadMore('account');
  const ids = discovery.store.getState().visibleEntries.map(app => app.manifest!.id);
  expect(ids).toEqual([...busy, ...older].map(event => event.id));
  expect(new Set(ids).size).toBe(235);
});

it('keeps only the newest release of an application across relay pages', async () => {
  const newer = uniqueManifest(35130, 1000, 'same-app');
  const entries = Array.from({ length: 200 }, (_, i) => uniqueManifest(35130, 999 - i));
  const older = uniqueManifest(35130, 700, 'same-app');
  const { discovery } = setup({ [nappRelay]: [newer, ...entries, older] });
  await discovery.load('account');
  for (let i = 0; i < 11 && discovery.store.getState().hasMore; i++) await discovery.loadMore('account');
  expect(discovery.store.getState().visibleEntries).toHaveLength(201);
  expect(discovery.store.getState().visibleEntries.some(app => app.manifest!.id === older.id)).toBe(false);
});

it('uses inclusive time cursors without dropping a partially fetched timestamp boundary', async () => {
  const events = Array.from({ length: 205 }, (_, i) => uniqueManifest(35130, i < 199 ? 1000 - i : 500, `boundary-${i}`));
  const { discovery } = setup({ [nappRelay]: events });
  await discovery.load('account');
  for (let i = 0; i < 11 && discovery.store.getState().hasMore; i++) await discovery.loadMore('account');
  expect(new Set(discovery.store.getState().visibleEntries.map(app => app.manifest!.id)))
    .toEqual(new Set(events.map(event => event.id)));
});

it('stops at a saturated timestamp boundary instead of skipping undiscovered events or looping', async () => {
  const events = Array.from({ length: 210 }, (_, i) => uniqueManifest(35130, 800, `same-second-${i}`));
  const { query, discovery } = setup({ [nappRelay]: events });
  await discovery.load('account');
  for (let i = 0; i < 10; i++) await discovery.loadMore('account');
  expect(discovery.store.getState()).toMatchObject({ error: true, hasMore: true });
  expect(discovery.store.getState().visibleEntries).toHaveLength(200);
  expect(query).toHaveBeenCalledTimes(3);
});

it('shares in-flight reads, caches the visible page and preserves content after a failed refresh', async () => {
  const { query, destroy, discovery } = setup({ [nappRelay]: [uniqueManifest(35130, 100)] });
  let resolve!: (value: { events: ReturnType<typeof manifest>[]; incomplete: boolean }) => void;
  query.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const first = discovery.load('account');
  expect(discovery.load('account')).toBe(first);
  expect(discovery.loadMore('account')).toBe(first);
  while (!resolve) await flush();
  resolve({ events: [uniqueManifest(35130, 100)], incomplete: false });
  await first;
  const requests = query.mock.calls.length;
  await discovery.load('account');
  expect(query).toHaveBeenCalledTimes(requests);
  query.mockRejectedValue(new Error('offline'));
  await discovery.load('account', true);
  expect(discovery.store.getState()).toMatchObject({ loaded: true, loading: false, error: true });
  expect(discovery.store.getState().visibleEntries).toHaveLength(1);
  expect(destroy).toHaveBeenCalledTimes(2);
});

it('queues and deduplicates an explicit refresh behind an in-flight read', async () => {
  const old = uniqueManifest(35130, 100);
  const latest = uniqueManifest(35130, 200);
  const data = { [nappRelay]: [old] };
  const { query, discovery } = setup(data);
  let finish!: (value: { events: ReturnType<typeof manifest>[]; incomplete: boolean }) => void;
  query.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const initial = discovery.load('account');
  const refresh = discovery.load('account', true);
  expect(refresh).not.toBe(initial);
  expect(discovery.load('account', true)).toBe(refresh);
  expect(discovery.loadMore('account')).toBe(refresh);
  while (!finish) await flush();
  data[nappRelay] = [latest, old];
  finish({ events: [old], incomplete: false });
  await initial;
  await refresh;
  expect(query.mock.calls.filter(([, [filter]]) => filter.until === undefined)).toHaveLength(4);
  expect(discovery.store.getState().visibleEntries[0].manifest!.id).toBe(latest.id);
});

it('restarts cursors and the 20-entry window when explicitly refreshed', async () => {
  const data = { [nappRelay]: Array.from({ length: 60 }, (_, i) => uniqueManifest(35130, 1000 - i)) };
  const { query, discovery } = setup(data);
  await discovery.load('account');
  const first = discovery.loadMore('account');
  expect(discovery.loadMore('account')).toBe(first);
  await first;
  expect(discovery.store.getState().visibleEntries).toHaveLength(40);
  data[nappRelay].push(uniqueManifest(35130, 2000));
  await discovery.load('account', true);
  expect(discovery.store.getState().visibleEntries).toHaveLength(20);
  expect(discovery.store.getState().visibleEntries[0].manifest!.created_at).toBe(2000);
  expect(query.mock.calls.slice(-2).every(([, filters]) => filters[0].until === undefined)).toBe(true);
});
