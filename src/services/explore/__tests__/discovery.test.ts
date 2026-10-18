import { finalizeEvent, generateSecretKey } from 'nostr-tools';
import { discoveryEntries, discoverApplications, discoveryStore, EXPLORE_KINDS, EXPLORE_RELAYS } from '../discovery';
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

it('shares in-flight requests, caches complete results and preserves content after refresh failure', async () => {
  let resolve!: (value: { events: ReturnType<typeof manifest>[]; incomplete: boolean }) => void;
  const query = jest.fn().mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const destroy = jest.fn();
  jest.mocked(NappletNetwork).mockImplementation(() => ({ query, destroy }) as unknown as NappletNetwork);
  const first = discoverApplications('account', true);
  expect(discoverApplications('account')).toBe(first);
  expect(query).toHaveBeenCalledWith(EXPLORE_RELAYS, EXPLORE_KINDS.map(kind => ({ kinds: [kind], limit: 60 })));
  resolve({ events: [manifest(35130)], incomplete: false });
  await first;
  await discoverApplications('account');
  expect(query).toHaveBeenCalledTimes(1);
  query.mockRejectedValueOnce(new Error('offline'));
  await discoverApplications('account', true);
  expect(discoveryStore.getState()).toMatchObject({ loading: false, loaded: true, error: true });
  expect(discoveryStore.getState().entries).toHaveLength(1);
  expect(destroy).toHaveBeenCalledTimes(2);
});
