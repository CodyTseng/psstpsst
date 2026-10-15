import { finalizeEvent, generateSecretKey } from 'nostr-tools';
import { naddrEncode } from 'nostr-tools/nip19';
import { appShareAddress, boundedFilters, parseAppAddress, parseManifest, publicUrl } from '../protocol';
import { validateSchema, validateValues } from '../config';

const secret = generateSecretKey();
function manifest(kind = 35129, tags: string[][] = [['d', 'test']]) {
  return finalizeEvent(
    {
      kind,
      tags: [...tags, ['x', 'a'.repeat(64)], ['R', 'storage']],
      content: 'A test application',
      created_at: 100,
    },
    secret,
  );
}
test('manifest identity retains publisher, kind and opaque d value', () => {
  const event = manifest();
  const release = parseManifest(event);
  expect(release.key).toBe(`35129:${event.pubkey}:test`);
  const other = finalizeEvent(
    { kind: 35129, tags: event.tags, content: event.content, created_at: event.created_at },
    generateSecretKey(),
  );
  expect(parseManifest(other).key).not.toBe(release.key);
  expect(parseManifest(manifest(15129, [])).key).toBe(`15129:${event.pubkey}:`);
  const snapshot = manifest(5129, []);
  expect(parseManifest(snapshot).key).toBe(`5129:${snapshot.id}`);
});
test('tampering and duplicate hashes are rejected before installation', () => {
  expect(() => parseManifest({ ...manifest(), content: 'tampered' })).toThrow();
  expect(() =>
    parseManifest(
      manifest(35129, [
        ['d', 'test'],
        ['x', 'b'.repeat(64)],
      ]),
    ),
  ).toThrow();
  expect(() => parseManifest(manifest(15129, [['d', 'unexpected']]))).toThrow();
});
test('address parsing only admits supported manifest coordinates', () => {
  const event = manifest();
  expect(
    parseAppAddress(naddrEncode({ pubkey: event.pubkey, kind: 35129, identifier: 'test' })).filters,
  ).toEqual([{ kinds: [35129], authors: [event.pubkey], '#d': ['test'] }]);
  expect(() =>
    parseAppAddress(naddrEncode({ pubkey: event.pubkey, kind: 30023, identifier: 'test' })),
  ).toThrow();
});
test.each([
  'http://example.com',
  'https://127.0.0.1/',
  'https://10.1.1.1/',
  'https://user:secret@example.com/',
  'https://example.local/',
  'https://[::1]/',
])('rejects unsafe resource URL %s', (url) => expect(() => publicUrl(url)).toThrow());
test('filters cannot allocate unbounded histories or inject arbitrary fields', () => {
  expect(boundedFilters({ kinds: [1], limit: 100000 })[0].limit).toBe(200);
  expect(() => boundedFilters({ ids: Array(101).fill('a') })).toThrow();
  expect(() => boundedFilters({ limit: -1 })).toThrow();
  expect(() => boundedFilters({ arbitrary: true })).toThrow();
});
test('configuration validation rejects active references and invalid values', () => {
  expect(() =>
    validateSchema({ type: 'object', properties: {}, $ref: 'https://example.com' }),
  ).toThrow();
  const schema = validateSchema({
    type: 'object',
    properties: { count: { type: 'integer', minimum: 0, maximum: 5 } },
    required: ['count'],
  });
  expect(() => validateValues(schema, { count: 3 })).not.toThrow();
  expect(() => validateValues(schema, {})).toThrow();
  expect(() => validateValues(schema, { count: 6 })).toThrow();
  expect(() => validateValues(schema, { count: 2, extra: true })).toThrow();
});

test.each([5129, 15129, 35129])('shared app kind %s round-trips to its install address', (kind) => {
  const release = parseManifest(manifest(kind, kind === 35129 ? [['d', 'shared-app']] : []));
  const address = appShareAddress(release);
  expect(parseAppAddress(address).filters).toEqual(kind === 5129 ? [{ ids: [release.event.id] }] : [{
    kinds: [kind], authors: [release.event.pubkey], ...(kind === 35129 ? { '#d': ['shared-app'] } : {}),
  }]);
});
