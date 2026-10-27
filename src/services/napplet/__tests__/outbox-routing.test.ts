import type { Event } from 'nostr-tools';
import { groupOutboxAuthors, outboxWriteRelays } from '../outbox-routing';
import { MARKET_RELAYS } from '../protocol';

it('uses default relays for missing or excessive write lists and respects read-only hints', () => {
  expect(outboxWriteRelays(null)).toEqual(MARKET_RELAYS);
  const event = { tags: [['r', 'wss://read.example', 'read'], ['r', 'wss://write.example', 'write'], ['r', 'wss://both.example']] } as Event;
  expect(outboxWriteRelays(event)).toEqual(['wss://write.example/', 'wss://both.example/']);
  expect(outboxWriteRelays({ tags: Array.from({ length: 9 }, (_, i) => ['r', `wss://relay-${i}.example`]) } as Event)).toEqual(MARKET_RELAYS);
});

it('greedily prunes redundant small groups while preserving two destinations per author', () => {
  const lists = new Map(Array.from({ length: 100 }, (_, i) => [`author-${i}`, ['wss://shared-a.example/', 'wss://shared-b.example/', `wss://unique-${i}.example/`]]));
  const groups = groupOutboxAuthors(lists);
  expect([...groups.keys()]).toEqual(['wss://shared-a.example/', 'wss://shared-b.example/']);
  expect([...groups.values()].map(authors => authors.length)).toEqual([100, 100]);
});

it('retains sparse destinations needed for coverage even when there are more than 24 relays', () => {
  const lists = new Map(Array.from({ length: 30 }, (_, i) => [`author-${i}`, [`wss://a-${i}.example/`, `wss://b-${i}.example/`]]));
  const groups = groupOutboxAuthors(lists);
  expect(groups.size).toBe(60);
  for (const author of lists.keys()) expect([...groups.values()].filter(authors => authors.includes(author))).toHaveLength(2);
});
