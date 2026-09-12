import {
  BLOSSOM_UPLOAD_FALLBACK_SERVER,
  DEFAULT_BLOSSOM_SERVERS,
  createBlossomUploadPlan,
  eligibleBlossomMirrorTargets,
  withBlossomUploadFallback,
} from '../blossom-url';

describe('Blossom upload fallback', () => {
  test('recommends only the Jumble server by default', () => {
    expect(DEFAULT_BLOSSOM_SERVERS).toEqual(['https://blossom.jumble.social']);
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
