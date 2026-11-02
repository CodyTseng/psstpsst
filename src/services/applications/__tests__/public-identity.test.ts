import { nip19, type Event } from 'nostr-tools';
import { PublicIdentityData, followedPubkeys, profileMetadata, rememberPublishedIdentity } from '../public-identity';
import type { ApplicationNetwork } from '../network';
import { NappData } from '@/services/explore/data';
import { CommonActions } from '@/services/napplet/common';
import { localRelay } from '@/services/local-relay';

jest.mock('@/services/local-relay', () => ({ localRelay: { subscribe: jest.fn(() => () => {}), query: jest.fn(async () => [] as Event[]) } }));
jest.mock('@/services/applications/network', () => ({ relayUrls: (urls: string[]) => urls }));
const account = 'a'.repeat(64), target = 'b'.repeat(64), relay = 'wss://writer.example/';
const event = (kind: number, created_at = 1): Event => ({ id: String(created_at), pubkey: account, kind, created_at, content: kind === 0 ? '{"name":"Alice"}' : '', tags: kind === 3 ? [['p', target], ['p', target]] : [], sig: '' });
const lives: AbortController[] = [];
function fixture() {
  const life = new AbortController(); lives.push(life);
  const query = jest.fn(async (_relays: string[], filters: any[]) => ({ events: filters.flatMap(filter => filter.kinds.map((kind: number) => event(kind))), incomplete: false, error: undefined as string | undefined }));
  const network = { accountPubkey: account, routes: jest.fn(async () => [relay]), query } as unknown as ApplicationNetwork;
  return { life, network, query, data: new PublicIdentityData(network, life.signal) };
}
beforeEach(() => { jest.mocked(localRelay.query).mockResolvedValue([]); });
afterEach(() => { lives.splice(0).forEach(life => life.abort()); });

it('batches profile and follows on author write relays and reuses complete cached results', async () => {
  const { data, network, query } = fixture();
  const [profile, list] = await Promise.all([data.profile(account), data.follows(account)]);
  expect(profile.metadata).toEqual({ name: 'Alice' });
  expect(await followedPubkeys(list, () => {})).toEqual([target]);
  expect(network.routes).toHaveBeenCalledTimes(1);
  expect(query).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[0][0]).toEqual([relay]);
  await data.profile(account); await data.follows(account);
  expect(query).toHaveBeenCalledTimes(1);
});

it('gives Napp and Napplet adapters the same public profile and follow events', async () => {
  const { data, network, life } = fixture();
  const napp = new NappData(account, network, life.signal);
  const common = new CommonActions({ account, network, identity: data, publish: async () => { throw new Error('unexpected-publication'); } });
  try {
    const [user, profile, list, follows] = await Promise.all([
      napp.user(account), common.handle('getProfile', { target: account }, () => {}),
      napp.list('loadFollowsList', account), common.handle('follows', {}, () => {}),
    ]);
    expect(user.event).toEqual(profile.result.event);
    expect(user.metadata).toEqual(profile.profile);
    expect(list.items).toEqual(follows.pubkeys);
  } finally { common.close(); }
});

it('uses cached public evidence for reads but refuses incomplete follow mutation snapshots', async () => {
  const { data, query } = fixture();
  jest.mocked(localRelay.query).mockResolvedValue([event(3, 2)]);
  query.mockResolvedValue({ events: [], incomplete: true, error: 'network-error' });
  expect(await data.follows(account)).toEqual(event(3, 2));
  await expect(data.follows(account, { fresh: true, requireComplete: true })).rejects.toThrow('network-error');
});

it('rejects mutation snapshots if any write relay fails even when another relay returns the list', async () => {
  const { data, network, query } = fixture();
  jest.mocked(network.routes).mockResolvedValue([relay, 'wss://offline.example/']);
  query.mockImplementation(async ([url]) => url === relay ? { events: [event(3)], incomplete: false, error: undefined } : { events: [], incomplete: true, error: 'network-error' });
  await expect(data.follows(account, { fresh: true, requireComplete: true })).rejects.toThrow('network-error');
});

it('merges profile pointer hints with write routes and selects the newest evidence', async () => {
  const { data, query } = fixture();
  const hint = 'wss://hint.example/';
  query.mockImplementation(async ([url]) => ({ events: [event(0, url === hint ? 2 : 1)], incomplete: false, error: undefined }));
  const profile = await data.profile(nip19.nprofileEncode({ pubkey: account, relays: [hint] }));
  expect(profile.event?.created_at).toBe(2);
  expect(query.mock.calls.map(([urls]) => urls[0]).sort()).toEqual([hint, relay].sort());
});

it('invalidates shared metadata caches after public local-relay updates', async () => {
  const { data, query } = fixture();
  await data.profile(account);
  const listener = jest.mocked(localRelay.subscribe).mock.calls.at(-1)![1];
  listener(event(0, 2));
  await data.profile(account);
  expect(query).toHaveBeenCalledTimes(2);
});

it('cancels queued reads and consistently tolerates malformed profile metadata', async () => {
  const { data, life } = fixture();
  const read = data.profile(account);
  life.abort();
  await expect(read).rejects.toThrow('session-closed');
  expect(profileMetadata({ ...event(0), content: 'invalid' })).toEqual({});
  expect(profileMetadata({ ...event(0), content: '[]' })).toEqual({});
});

it('propagates successful public changes between format caches within the owning account', async () => {
  const one = fixture(), two = fixture(), other = fixture();
  Object.assign(other.network, { accountPubkey: target });
  await Promise.all([one.data.follows(account), two.data.follows(account), other.data.follows(account)]);
  const changed = { ...event(3, 2), tags: [] };
  rememberPublishedIdentity(one.network, changed);
  expect(await two.data.follows(account)).toEqual(changed);
  expect(await other.data.follows(account)).toEqual(event(3));
  expect(two.query).toHaveBeenCalledTimes(1);
});
