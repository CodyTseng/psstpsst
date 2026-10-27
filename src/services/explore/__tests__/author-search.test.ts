import type { Event } from 'nostr-tools';
import { NappData } from '../data';
import { localRelay } from '@/services/local-relay';
import type { NappletNetwork } from '@/services/napplet/network';

jest.mock('@/services/local-relay', () => ({ localRelay: { subscribe: () => () => {}, query: jest.fn(async () => []) } }));
jest.mock('@/services/napplet/network', () => ({ relayUrls: (urls: string[]) => urls }));

const first = 'a'.repeat(64), second = 'b'.repeat(64);
const profile = (pubkey: string, name: string, about = '') => ({
  id: pubkey, pubkey, kind: 0, created_at: 1, tags: [], content: JSON.stringify({ name, about }), sig: '',
} as Event);

it.each([
  { label: 'excludes muted candidates before applying the limit', follows: [] as string[], muted: [first],
    profiles: [profile(first, 'Alice'), profile(second, 'Alice Two')] },
  { label: 'keeps followed candidates even when an earlier match fills the limit', follows: [second], muted: [] as string[],
    profiles: [profile(first, 'Alice'), profile(second, 'Alice Two')] },
  { label: 'ranks name prefixes ahead of earlier matches in the about field', follows: [] as string[], muted: [] as string[],
    profiles: [profile(first, 'Bob', 'Alice'), profile(second, 'Alice')] },
])('$label', async ({ follows, muted, profiles }) => {
  jest.mocked(localRelay.query).mockResolvedValueOnce(profiles);
  const life = new AbortController(), data = new NappData('account', {} as NappletNetwork, life.signal);
  jest.spyOn(data, 'list').mockImplementation(async method => ({ event: null,
    items: method === 'loadFollowsList' ? follows : muted.map(value => ({ label: 'pubkey', value })),
  }));
  try {
    expect((await data.searchLocal('alice', 1)).map(user => user.pubkey)).toEqual([first]);
    expect((await data.findAuthors('alice', { limit: 1 })).map(user => user.pubkey)).toEqual([second]);
  } finally { life.abort(); }
});
