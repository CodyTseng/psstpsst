import {
  getCachedProximityPubkey,
  rememberProximityPubkey,
} from '../proximity-identity.service';

jest.mock('@/db/client', () => ({ db: {} }));

describe('proximity identity session cache', () => {
  test('keeps public keys isolated by owning account', () => {
    expect(getCachedProximityPubkey('cache-account-a')).toBeUndefined();
    expect(getCachedProximityPubkey('cache-account-b')).toBeUndefined();

    rememberProximityPubkey('cache-account-a', 'proximity-a');
    rememberProximityPubkey('cache-account-b', 'proximity-b');

    expect(getCachedProximityPubkey('cache-account-a')).toBe('proximity-a');
    expect(getCachedProximityPubkey('cache-account-b')).toBe('proximity-b');
  });

  test('refreshes a cached public key for the same account', () => {
    rememberProximityPubkey('cache-account-refresh', 'proximity-old');
    rememberProximityPubkey('cache-account-refresh', 'proximity-new');

    expect(getCachedProximityPubkey('cache-account-refresh')).toBe('proximity-new');
  });
});
