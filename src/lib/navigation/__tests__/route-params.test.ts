import {
  optionalRouteTextParam,
  parseConversationRouteParams,
  routeEmojiCoordinateParam,
  routeHexIdParam,
  routeOpaqueIdParam,
  routeStringParam,
} from '../route-params';

const PUBKEY = 'a'.repeat(64);

describe('route parameter validation', () => {
  it('accepts one already-decoded bounded string', () => {
    expect(routeStringParam('hello%world', 20)).toBe('hello%world');
    expect(routeStringParam(['first', 'second'], 20)).toBeNull();
    expect(routeStringParam('x'.repeat(21), 20)).toBeNull();
    expect(routeStringParam('line\nbreak', 20)).toBeNull();
  });

  it('normalizes hexadecimal identifiers without decoding them again', () => {
    expect(routeHexIdParam(PUBKEY.toUpperCase())).toBe(PUBKEY);
    expect(routeHexIdParam('%')).toBeNull();
    expect(routeHexIdParam('a'.repeat(63))).toBeNull();
    expect(routeHexIdParam(['a'.repeat(64)])).toBeNull();
  });

  it('validates opaque ids and emoji coordinates', () => {
    expect(routeOpaqueIdParam('wallet:device_1')).toBe('wallet:device_1');
    expect(routeOpaqueIdParam('../wallet')).toBeNull();
    expect(routeEmojiCoordinateParam(`30030:${PUBKEY}:pack`)).toBe(
      `30030:${PUBKEY}:pack`,
    );
    expect(routeEmojiCoordinateParam(`30030:${PUBKEY}:`)).toBeNull();
  });

  it('distinguishes absent optional text from malformed text', () => {
    expect(optionalRouteTextParam(undefined, 20)).toBeUndefined();
    expect(optionalRouteTextParam('', 20)).toBeUndefined();
    expect(optionalRouteTextParam('Alice', 20)).toBe('Alice');
    expect(optionalRouteTextParam(['Alice'], 20)).toBeNull();
  });

  it('accepts only complete conversation routes', () => {
    expect(parseConversationRouteParams({ key: PUBKEY })).toEqual({
      key: PUBKEY,
      transport: 'relay',
    });
    expect(
      parseConversationRouteParams({ key: PUBKEY, transport: 'proximity', name: 'Nearby' }),
    ).toEqual({ key: PUBKEY, transport: 'proximity', name: 'Nearby' });
    expect(parseConversationRouteParams({ key: PUBKEY, transport: 'unknown' })).toBeNull();
    expect(parseConversationRouteParams({ key: '%' })).toBeNull();
  });
});
