import { buildBlossomUri } from '@/lib/nostr/blossom-uri';

import { parseNearbyFileOffer } from '../proximity-file-offer';

const X = '11'.repeat(32);
const OX = '22'.repeat(32);

function tags() {
  return [
    ['file-type', 'image/jpeg'],
    ['encryption-algorithm', 'aes-gcm'],
    ['decryption-key', '33'.repeat(32)],
    ['decryption-nonce', '44'.repeat(12)],
    ['x', X],
    ['ox', OX],
    ['size', '116'],
    ['plain-size', '100'],
  ];
}

describe('Nearby file offer', () => {
  it('requires matching x, ox, and plaintext/ciphertext size invariants', () => {
    const content = buildBlossomUri(X, ['https://media.example']);
    expect(parseNearbyFileOffer(content, tags())).toEqual(
      expect.objectContaining({
        cipherSha256Hex: X,
        plainSha256Hex: OX,
        size: 116,
        plainSize: 100,
      }),
    );
    expect(
      parseNearbyFileOffer(
        content,
        tags().map((tag) => (tag[0] === 'plain-size' ? ['plain-size', '101'] : tag)),
      ),
    ).toBeNull();
    expect(
      parseNearbyFileOffer(
        content,
        tags().map((tag) => (tag[0] === 'x' ? ['x', '55'.repeat(32)] : tag)),
      ),
    ).toBeNull();
  });

  it('does not grant direct transfer to ordinary HTTP attachments', () => {
    expect(parseNearbyFileOffer(`https://media.example/${X}`, tags())).toBeNull();
  });
});
