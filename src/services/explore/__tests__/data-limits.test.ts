import type { Event } from 'nostr-tools';
import { NappData } from '../data';
import { publicEventAddress } from '../event-address';
import { localRelay } from '@/services/local-relay';
import type { NappletNetwork } from '@/services/napplet/network';

jest.mock('@/services/local-relay', () => ({ localRelay: { subscribe: () => () => {}, query: jest.fn(async () => []) } }));
jest.mock('@/services/napplet/network', () => ({ relayUrls: (urls: string[]) => urls }));

it('loads every requested event beyond 1000 IDs using internal batches', async () => {
  const ids = Array.from({ length: 1201 }, (_, i) => i.toString(16).padStart(64, '0'));
  jest.mocked(localRelay.query).mockImplementation(async (input: any) => input.ids.map((id: string) => ({ id } as Event)));
  const life = new AbortController(), data = new NappData('account', {} as NappletNetwork, life.signal);
  try { expect((await data.loadEvents(ids)).map(event => event.id)).toEqual(ids); }
  finally { life.abort(); }
});

it('resolves every referenced set beyond the former 128-pointer limit', async () => {
  const life = new AbortController(), data = new NappData('account', {} as NappletNetwork, life.signal);
  const items = Array.from({ length: 150 }, (_, i) => ({ kind: 30002, pubkey: 'a'.repeat(64), identifier: String(i), relays: [] }));
  jest.spyOn(data, 'list').mockResolvedValue({ event: null, items });
  const load = jest.spyOn(data, 'loadEvent').mockResolvedValue(null);
  try { expect(await data.withSets('fetchFavoriteRelaysWithSets', 'a'.repeat(64))).toHaveLength(150);expect(load).toHaveBeenCalledTimes(150); }
  finally { life.abort(); }
});

it('preserves long identifiers and all relay hints in event pointers', () => {
  const identifier = 'x'.repeat(5000), relays = Array.from({ length: 30 }, (_, i) => `wss://relay-${i}.example/`);
  const result = publicEventAddress({ type: 'naddr', data: { kind: 30023, pubkey: 'a'.repeat(64), identifier, relays } });
  expect(result.relays).toEqual(relays);expect(result.filters[0]['#d']).toEqual([identifier]);
});
