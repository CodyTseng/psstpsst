import { naddrEncode, neventEncode } from 'nostr-tools/nip19';
import { favoriteReference, parseFavoriteReference, parseFavoriteSnapshot } from '../favorites-protocol';
import { websiteEntry } from '../model';
const author = 'b'.repeat(64);
it('round-trips ordered app/root/event/URL references with private relay hints', () => {
  const tags = [
    ['a', `35130:${author}:notes`, 'wss://relay.example/'],
    ['a', `35129:${author}:mini`],
    ['a', `15129:${author}:`],
    ['a', `15128:${author}:`],
    ['e', 'c'.repeat(64), '', author],
    ['r', 'https://example.com/path?q=1#section'],
  ];
  const parsed = parseFavoriteSnapshot(JSON.stringify(tags));
  expect(parsed.map(item => favoriteReference(item.entry))).toEqual(tags);
  expect(parsed[0].entry.key).toBe(naddrEncode({ kind: 35130, pubkey: author, identifier: 'notes' }));
  expect(parsed[4].entry.key).toBe(neventEncode({ id: 'c'.repeat(64) }));
  expect(parsed[3].entry.kind).toBe('nsite');
});
it('deduplicates identities independent of relay hints while retaining first position', () => {
  const a = ['a', `35130:${author}:notes`];
  expect(parseFavoriteSnapshot(JSON.stringify([a, ['r', 'https://EXAMPLE.com/'], [...a, 'wss://other.example/']]))).toHaveLength(2);
});
it('encodes website paths independently and supports an empty collection', () => {
  expect(favoriteReference(websiteEntry('https://example.com/a'))).toEqual(['r', 'https://example.com/a']);
  expect(parseFavoriteSnapshot('[]')).toEqual([]);
});
it.each([
  '{}', '[null]', '[["a","35130:bad:key"]]', '[["r","javascript:alert(1)"]]',
  JSON.stringify([['a', `30023:${author}:article`]]), JSON.stringify(Array.from({ length: 513 }, () => ['r', 'https://example.com'])),
])('rejects malformed/unsupported snapshots instead of turning them into empty favorites: %s', value => {
  expect(() => parseFavoriteSnapshot(value)).toThrow();
});
it('requires the trailing colon for a root reference', () => {
  expect(() => parseFavoriteReference(['a', `15129:${author}`])).toThrow();
});
