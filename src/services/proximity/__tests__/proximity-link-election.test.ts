import {
  preferredProximityEndpointRole,
  selectCanonicalProximityEndpoint,
} from '../proximity-link-election';

const LOWER = '1'.repeat(64);
const HIGHER = 'e'.repeat(64);

describe('proximity link election', () => {
  it('gives the lower public key the Central role', () => {
    expect(preferredProximityEndpointRole(LOWER, HIGHER)).toBe('central');
    expect(preferredProximityEndpointRole(HIGHER, LOWER)).toBe('peripheral');
  });

  it('selects by authenticated role even when platform endpoint ids do not match', () => {
    const endpoints = ['p:ios-central-id', 'c:android-peripheral-id'];
    expect(selectCanonicalProximityEndpoint(LOWER, HIGHER, endpoints)).toBe(
      'c:android-peripheral-id',
    );
    expect(selectCanonicalProximityEndpoint(HIGHER, LOWER, endpoints)).toBe(
      'p:ios-central-id',
    );
  });

  it('keeps the current endpoint when it already has the preferred role', () => {
    const endpoints = ['c:new-address', 'c:stable-address', 'p:other-role'];
    expect(
      selectCanonicalProximityEndpoint(
        LOWER,
        HIGHER,
        endpoints,
        'c:stable-address',
      ),
    ).toBe('c:stable-address');
  });

  it('uses the only authenticated role as a fallback', () => {
    expect(
      selectCanonicalProximityEndpoint(LOWER, HIGHER, ['p:only-link']),
    ).toBe('p:only-link');
  });
});
