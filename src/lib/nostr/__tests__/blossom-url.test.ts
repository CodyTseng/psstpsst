import {
  BLOSSOM_UPLOAD_FALLBACK_SERVER,
  DEFAULT_BLOSSOM_SERVERS,
  createBlossomUploadPlan,
  eligibleBlossomMirrorTargets,
  withBlossomUploadFallback,
  normalizeBlossomUrl,
  normalizeBlossomUrls,
  normalizeAdvertisedBlossomUrl,
} from '../blossom-url';

describe('Blossom URL normalization', () => {
  it.each([
    ['https://MEDIA.example', 'https://media.example/'],
    ['https://media.example/', 'https://media.example/'],
    [' HTTPS://MEDIA.example:443/ ', 'https://media.example/'],
    ['http://MEDIA.example:80/', 'http://media.example/'],
    ['media.example', 'https://media.example/'],
    ['localhost:8080', 'http://localhost:8080/'],
    ['192.168.1.2:8080', 'http://192.168.1.2:8080/'],
    ['https://media.example//api///?z=2&a=1#fragment', 'https://media.example/api?a=1&z=2'],
    ['https://media.example/api/', 'https://media.example/api'],
    ['https://media.example/api', 'https://media.example/api'],
    ['https://media.example?token=a/b/', 'https://media.example/?token=a%2Fb%2F'],
  ])('normalizes %s to %s and remains idempotent', (input, expected) => {
    expect(normalizeBlossomUrl(input)).toBe(expected);
    expect(normalizeBlossomUrl(expected)).toBe(expected);
  });

  it('deduplicates equivalent root and normalized path addresses', () => {
    expect(normalizeBlossomUrls([
      'https://MEDIA.example', 'https://media.example/', 'https://media.example/api',
      'https://media.example/api/', 'https://',
    ])).toEqual(['https://media.example/', 'https://media.example/api']);
  });

  it.each(['', ' ', 'https://', 'ftp://media.example', 'wss://media.example'])('rejects invalid HTTP(S) server %s', input => {
    expect(() => normalizeBlossomUrl(input)).toThrow();
  });
});

describe('Blossom upload fallback', () => {
  test('recommends only the Jumble server by default', () => {
    expect(DEFAULT_BLOSSOM_SERVERS).toEqual(['https://blossom.jumble.social/']);
  });

  test('appends Jumble after configured servers', () => {
    expect(withBlossomUploadFallback(['https://media.example'])).toEqual([
      'https://media.example',
      BLOSSOM_UPLOAD_FALLBACK_SERVER,
    ]);
  });

  test('does not duplicate an existing normalized Jumble endpoint', () => {
    expect(
      withBlossomUploadFallback([
        'https://media.example',
        'https://BLOSSOM.JUMBLE.SOCIAL/',
      ]),
    ).toEqual(['https://media.example', 'https://BLOSSOM.JUMBLE.SOCIAL/']);
  });

  test('uses Jumble when the configured list is empty', () => {
    expect(withBlossomUploadFallback([])).toEqual([BLOSSOM_UPLOAD_FALLBACK_SERVER]);
  });

  test('keeps the runtime fallback out of mirror targets', () => {
    expect(createBlossomUploadPlan(['https://media.example'])).toEqual({
      uploadCandidates: ['https://media.example', BLOSSOM_UPLOAD_FALLBACK_SERVER],
      mirrorTargets: ['https://media.example'],
    });
  });

  test('does not mirror to a server that failed the primary upload', () => {
    expect(
      eligibleBlossomMirrorTargets(
        ['https://failed.example/', 'https://main.example', 'https://mirror.example'],
        'https://main.example',
        new Set(['https://failed.example']),
      ),
    ).toEqual(['https://mirror.example']);
  });
});

it.each([
  ['https://MEDIA.example:443/as/Typed/', 'https://media.example/as/Typed'],
  ['http://127.0.0.1:8080/', 'http://127.0.0.1:8080/'],
  ['https://localhost:8443/media/', 'https://localhost:8443/media'],
  ['http://[::1]:8080/', 'http://[::1]:8080/'],
  ['http://blossom.local/', 'http://blossom.local/'],
])('normalizes an advertised media server without excluding local endpoints: %s', (url, expected) => {
  expect(normalizeAdvertisedBlossomUrl(url)).toBe(expected);
});

it.each([
  'https://media.example/file?',
  'https://media.example/file#',
  'https://user:pass@media.example/file',
  'file:///tmp/file',
  'ftp://media.example/file',
  'https:///media.example/file',
  'http://',
])('rejects a malformed or credential-bearing media URL: %s', url => {
  expect(() => normalizeAdvertisedBlossomUrl(url)).toThrow('Invalid advertised media server URL');
});
