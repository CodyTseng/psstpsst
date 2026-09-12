import { verificationCodeFromPubkey } from '../verification-code';

describe('verificationCodeFromPubkey', () => {
  test('formats the leading public-key bytes as two uppercase groups', () => {
    expect(verificationCodeFromPubkey('a1b2c3d4'.padEnd(64, '0'))).toBe('A1B2 C3D4');
  });
});
