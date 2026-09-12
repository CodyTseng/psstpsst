import { proximityPairingCode } from '../proximity-pairing-code';

describe('proximity pairing code', () => {
  const first = '01'.repeat(32);
  const second = 'ab'.repeat(32);

  test('is stable regardless of which peer initiates', () => {
    expect(proximityPairingCode(first, second)).toBe(proximityPairingCode(second, first));
  });

  test('formats a pair-specific digest for human comparison', () => {
    expect(proximityPairingCode(first, second)).toBe('1533 BA4A');
    expect(proximityPairingCode(first, second)).not.toBe(
      proximityPairingCode(first, 'cd'.repeat(32)),
    );
  });

  test('normalizes hexadecimal key casing', () => {
    expect(proximityPairingCode(first.toUpperCase(), second.toUpperCase())).toBe(
      proximityPairingCode(first, second),
    );
  });

  test('rejects malformed public keys', () => {
    expect(() => proximityPairingCode('not-a-key', second)).toThrow(
      'Invalid proximity public key',
    );
  });
});
