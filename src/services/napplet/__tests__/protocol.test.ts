import { finalizeEvent, generateSecretKey } from 'nostr-tools';
import { naddrEncode } from 'nostr-tools/nip19';
import { appShareAddress, boundedFilters, parseAppAddress, parseManifest, publicUrl } from '../protocol';
import { validateSchema, validateValues } from '../config';
import typeZoo from './fixtures/type-zoo-legacy.json';

const secret = generateSecretKey();
function legacy(tags = typeZoo.tags) {
  return finalizeEvent({ kind: 35129, tags, content: '', created_at: 100 }, secret);
}

test('reads the signed Type Zoo legacy manifest without rewriting its event or losing required capabilities', () => {
  const release = parseManifest(typeZoo);
  expect(JSON.parse(JSON.stringify(release.event))).toEqual(typeZoo);
  expect(release.hash).toBe('c42577a0adaeefd89a8ad10ca091c7e6ee406389d541b224a609c00a4908bd4f');
  expect(release.title).toBe('Type Zoo');
  expect(release.description).toBe(typeZoo.tags.find((tag) => tag[0] === 'description')![1]);
  expect(release.required).toEqual(['outbox', 'upload']);
  expect(release.optional).toEqual([]);
});

test('rejects a signed legacy aggregate mismatch and unsupported multi-file packages', () => {
  expect(() => parseManifest(legacy(typeZoo.tags.map((tag) => tag[0] === 'x' ? ['x', 'a'.repeat(64), 'aggregate'] : tag)))).toThrow();
  expect(() => parseManifest(legacy([...typeZoo.tags, ['path', '/other.js', 'a'.repeat(64)]]))).toThrow();
  expect(() => parseManifest({ ...typeZoo, content: 'tampered' })).toThrow();
});

test('does not reinterpret malformed standalone manifests as legacy or mix capability declarations', () => {
  expect(() => parseManifest(legacy(typeZoo.tags.map((tag) => tag[0] === 'x' ? ['x', typeZoo.tags.find((tag) => tag[0] === 'path')![2]] : tag)))).toThrow();
  expect(() => parseManifest(legacy([...typeZoo.tags, ['R', 'storage']]))).toThrow();
  expect(() => parseManifest(legacy([...typeZoo.tags, ['O', 'storage']]))).toThrow();
  expect(() => parseManifest(legacy([...typeZoo.tags, ['requires', 'outbox', 'upload']]))).toThrow();
});

test('requires aggregate binding for legacy snapshots and accepts signed path binding for roots', () => {
  const tags = typeZoo.tags.filter((tag) => !['d', 'x'].includes(tag[0]));
  const root = finalizeEvent({ kind: 15129, created_at: 100, content: '', tags }, secret);
  expect(parseManifest(root).hash).toBe(typeZoo.tags.find((tag) => tag[0] === 'path')![2]);
  const snapshot = finalizeEvent({ kind: 5129, created_at: 100, content: '', tags }, secret);
  expect(() => parseManifest(snapshot)).toThrow();
});
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
  expect(parseAppAddress(address).relays).toEqual([]);
  expect(parseAppAddress(address).filters).toEqual(kind === 5129 ? [{ ids: [release.event.id] }] : [{
    kinds: [kind], authors: [release.event.pubkey], ...(kind === 35129 ? { '#d': ['shared-app'] } : {}),
  }]);
});
