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

  const hash = 'ab'.repeat(32);
  const token = 'cd'.repeat(32);

  it.each([
    `https://cdn.example/${hash}`,
    `http://localhost:8100/subdir/${hash}.bin?token=${token}`,
    `blossom:${hash}.bin?xs=https%3A%2F%2Fcdn.example`,
  ])('reads the content hash from a blob locator: %s', (url) => {
    expect(findFileMeta(url, FILE_TAGS)?.cipherSha256Hex).toBe(hash);
  });

  it.each([
    `https://cdn.example/opaque?token=${token}`,
    `https://cdn.example/${token}/opaque`,
    `https://cdn.example/prefix-${token}.bin`,
  ])('uses only a local cache key when the hash is not the filename: %s', (url) => {
    expect(findFileMeta(url, FILE_TAGS)?.cipherSha256Hex).not.toMatch(/^[0-9a-f]{64}$/i);
  });

  it('prefers an explicit ciphertext hash over the URL filename', () => {
    expect(findFileMeta(`https://cdn.example/${token}.bin`, [...FILE_TAGS, ['x', hash]])
      ?.cipherSha256Hex).toBe(hash);
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
