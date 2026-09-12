import { buildFileTags, fileMime, findFileMeta } from '../file-tags';

const FILE_TAGS = [
  ['encryption-algorithm', 'aes-gcm'],
  ['decryption-key', '00'],
  ['decryption-nonce', '11'],
];

describe('file tags', () => {
  it.each([
    'video/mp4',
    'video/webm',
  ])('preserves an immutable event tagged as %s', (taggedMime) => {
    const tags = [...FILE_TAGS, ['file-type', taggedMime], ['duration', '4']];

    expect(fileMime(tags)).toBe(taggedMime);
    expect(findFileMeta('https://example.com/voice', tags)?.mime).toBe(taggedMime);
  });

  it('keeps ordinary video attachments as video', () => {
    const tags = [...FILE_TAGS, ['file-type', 'video/mp4']];

    expect(fileMime(tags)).toBe('video/mp4');
    expect(findFileMeta('https://example.com/video', tags)?.mime).toBe('video/mp4');
  });

  it('round-trips the distinct ciphertext and plaintext sizes', () => {
    const tags = buildFileTags({
      url: 'blossom:unused.bin',
      mime: 'application/pdf',
      cipherSha256Hex: '22'.repeat(32),
      plainSha256Hex: '33'.repeat(32),
      size: 116,
      plainSize: 100,
      decryptionKeyHex: '44'.repeat(32),
      decryptionNonceHex: '55'.repeat(12),
    });

    expect(findFileMeta('blossom:unused.bin', tags)).toEqual(
      expect.objectContaining({ size: 116, plainSize: 100 }),
    );
  });
});
