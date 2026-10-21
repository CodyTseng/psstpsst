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
    [['wss://relay.nostrapps.com/'], [{ kinds: [35130], limit: 100 }]],
    [['wss://relay.napplet.soy/'], [{ kinds: [5129, 15129, 35129], limit: 100 }]],
    [['wss://relay.nsite.lol/', 'wss://relay.nosto.re/'], [{ kinds: [15128, 35128], limit: 100 }]],
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
  created_at: time, content: 'Description', tags: [['d', name], ['path', '/index.html', 'a'.repeat(64)]] }, secret);
const nappRelay = 'wss://relay.nostrapps.com/';
const nsiteRelay = 'wss://relay.nsite.lol/';
const mirrorRelay = 'wss://relay.nosto.re/';
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
  const events = Array.from({ length: 125 }, (_, i) => uniqueManifest(35130, 1000 - i));
  const { query, discovery } = setup({ [nappRelay]: events });
  await discovery.load('account');
  expect(query).toHaveBeenCalledTimes(4);
  expect(query.mock.calls[0].slice(0, 2)).toEqual([[nappRelay], [{ kinds: [35130], limit: 100 }]]);
  expect(query.mock.calls[1][1]).toEqual([{ kinds: [5129, 15129, 35129], limit: 100 }]);
  expect(query.mock.calls[2].slice(0, 2)).toEqual([[nsiteRelay], [{ kinds: [15128, 35128], limit: 100 }]]);
  expect(query.mock.calls[3].slice(0, 2)).toEqual([[mirrorRelay], [{ kinds: [15128, 35128], limit: 100 }]]);
  expect(discovery.store.getState().entries).toHaveLength(20);
  for (let i = 0; i < 4; i++) await discovery.loadMore('account');
  expect(discovery.store.getState().entries).toHaveLength(100);
  expect(query).toHaveBeenCalledTimes(4);
  await discovery.loadMore('account');
  expect(query.mock.calls[4].slice(0, 2)).toEqual([[nappRelay], [{ kinds: [35130], limit: 100, until: 901 }]]);
  expect(discovery.store.getState().entries).toHaveLength(120);
  await discovery.loadMore('account');
  expect(discovery.store.getState()).toMatchObject({ hasMore: false, error: false });
  expect(discovery.store.getState().entries.map(app => app.manifest!.id)).toEqual(events.map(event => event.id));
  const requests = query.mock.calls.length;
  await discovery.loadMore('account');
  expect(query).toHaveBeenCalledTimes(requests);
});

it('merges independent relay histories in descending time order without skipping a busy source', async () => {
  const busy = Array.from({ length: 110 }, (_, i) => uniqueManifest(35130, 1000 - i));
  const older = Array.from({ length: 25 }, (_, i) => uniqueManifest(35128, 500 - i));
  const { discovery } = setup({ [nappRelay]: busy, [nsiteRelay]: older, [mirrorRelay]: older });
  await discovery.load('account');
  for (let i = 0; i < 8 && discovery.store.getState().hasMore; i++) await discovery.loadMore('account');
  const ids = discovery.store.getState().entries.map(app => app.manifest!.id);
  expect(ids).toEqual([...busy, ...older].map(event => event.id));
  expect(new Set(ids).size).toBe(135);
});

it('keeps only the newest release of an application across relay pages', async () => {
  const newer = uniqueManifest(35130, 1000, 'same-app');
  const entries = Array.from({ length: 100 }, (_, i) => uniqueManifest(35130, 999 - i));
  const older = uniqueManifest(35130, 800, 'same-app');
  const { discovery } = setup({ [nappRelay]: [newer, ...entries, older] });
  await discovery.load('account');
  for (let i = 0; i < 6 && discovery.store.getState().hasMore; i++) await discovery.loadMore('account');
  expect(discovery.store.getState().entries).toHaveLength(101);
  expect(discovery.store.getState().entries.some(app => app.manifest!.id === older.id)).toBe(false);
});

it('uses inclusive time cursors without dropping a partially fetched timestamp boundary', async () => {
  const events = Array.from({ length: 105 }, (_, i) => uniqueManifest(35130, i < 99 ? 1000 - i : 800, `boundary-${i}`));
  const { discovery } = setup({ [nappRelay]: events });
  await discovery.load('account');
  for (let i = 0; i < 6 && discovery.store.getState().hasMore; i++) await discovery.loadMore('account');
  expect(new Set(discovery.store.getState().entries.map(app => app.manifest!.id)))
    .toEqual(new Set(events.map(event => event.id)));
});

it('stops at a saturated timestamp boundary instead of skipping undiscovered events or looping', async () => {
  const events = Array.from({ length: 110 }, (_, i) => uniqueManifest(35130, 800, `same-second-${i}`));
  const { query, discovery } = setup({ [nappRelay]: events });
  await discovery.load('account');
  for (let i = 0; i < 5; i++) await discovery.loadMore('account');
  expect(discovery.store.getState()).toMatchObject({ error: true, hasMore: true });
  expect(discovery.store.getState().entries).toHaveLength(100);
  expect(query).toHaveBeenCalledTimes(5);
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
  expect(discovery.store.getState().entries).toHaveLength(1);
  expect(destroy).toHaveBeenCalledTimes(2);
});

it('restarts cursors and the 20-entry window when explicitly refreshed', async () => {
  const data = { [nappRelay]: Array.from({ length: 60 }, (_, i) => uniqueManifest(35130, 1000 - i)) };
  const { query, discovery } = setup(data);
  await discovery.load('account');
  const first = discovery.loadMore('account');
  expect(discovery.loadMore('account')).toBe(first);
  await first;
  expect(discovery.store.getState().entries).toHaveLength(40);
  data[nappRelay].push(uniqueManifest(35130, 2000));
  await discovery.load('account', true);
  expect(discovery.store.getState().entries).toHaveLength(20);
  expect(discovery.store.getState().entries[0].manifest!.created_at).toBe(2000);
  expect(query.mock.calls.slice(-4).every(([, filters]) => filters[0].until === undefined)).toBe(true);
});
