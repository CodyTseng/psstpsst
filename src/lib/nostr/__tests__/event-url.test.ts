import { nip19 } from 'nostr-tools';

import { parseNostrEventReference } from '../event-reference';
import { DEFAULT_NOSTR_EVENT_URL, normalizeNostrEventUrl, nostrEventUrl } from '../event-url';

it.each(['', '   '])('restores Jumble for an empty URL: %s', (value) => {
  expect(normalizeNostrEventUrl(value)).toBe(DEFAULT_NOSTR_EVENT_URL);
});

it.each([
  [' https://example.com/{id} ', 'https://example.com/{id}'],
  ['http://localhost:3000/notes/{id}', 'http://localhost:3000/notes/{id}'],
  ['https://example.com/{id}', 'https://example.com/{id}'],
  ['https://example.com/view?note={id}&mode=full', 'https://example.com/view?note={id}&mode=full'],
  ['https://example.com/#/note/{id}', 'https://example.com/#/note/{id}'],
  ['nostr:{id}', 'nostr:{id}'],
  ['myapp://{id}', 'myapp://{id}'],
  ['myapp://note/{id}', 'myapp://note/{id}'],
  ['myapp:nostr:{id}', 'myapp:nostr:{id}'],
  ['MyApp+notes.v2://open?event={id}', 'MyApp+notes.v2://open?event={id}'],
])('normalizes %s', (value, expected) => {
  expect(normalizeNostrEventUrl(value)).toBe(expected);
});

it.each(['https://example.com/', 'http://localhost:3000/notes', 'nostr:', 'myapp://', 'myapp://note/'])(
  'requires an explicit placeholder instead of appending an identifier: %s', (value) => {
    expect(normalizeNostrEventUrl(value)).toBeNull();
  },
);

it.each([
  'example.com',
  'javascript:alert(1)',
  'file:///tmp/{id}',
  'JaVaScRiPt:{id}',
  'data:text/html,{id}',
  'vbscript:{id}',
  'blob:https://example.com/{id}',
  'about:{id}',
  'app://renderer/{id}',
  'psstpsst-file://{id}',
  'psstpsst://{id}',
  'c:/apps/{id}',
  '1app:{id}',
  '{id}:note',
  'myapp://open?note=',
  'myapp://user:password@open/{id}',
  'myapp:\u0000{id}',
  'https://',
  'https:///example.com',
  'https://user:password@example.com/{id}',
  'https://{id}.example.com/',
  'https://example.com/{note}',
  'https://example.com/a b/{id}',
  'https://example.com/view?note=',
  'https://example.com/?',
  'https://example.com/#',
  'https://example.com/#/notes',
  'https://example.com\\evil/{id}',
  `https://example.com/${'a'.repeat(2048)}`,
])('rejects an invalid or unsupported URL: %s', (value) => {
  expect(normalizeNostrEventUrl(value)).toBeNull();
});

it.each([
  nip19.noteEncode('ab'.repeat(32)),
  nip19.neventEncode({ id: 'ab'.repeat(32), relays: ['wss://relay.example.com'] }),
  nip19.naddrEncode({ pubkey: 'ab'.repeat(32), kind: 30023, identifier: 'article' }),
])('preserves the complete event identifier: %s', (bech32) => {
  const reference = parseNostrEventReference(`nostr:${bech32}`)!;
  expect(nostrEventUrl(reference, DEFAULT_NOSTR_EVENT_URL)).toBe(`https://jumble.social/${bech32}`);
  expect(nostrEventUrl(reference, 'https://example.com/?id={id}#{id}')).toBe(
    `https://example.com/?id=${bech32}#${bech32}`,
  );
  expect(nostrEventUrl(reference, 'nostr:{id}')).toBe(`nostr:${bech32}`);
  expect(nostrEventUrl(reference, 'myapp://{id}')).toBe(`myapp://${bech32}`);
});
