import { resolvePeerRelationship } from '../peer-relationship';

describe('resolvePeerRelationship', () => {
  it('shows a cached stranger on the first frame', () => {
    expect(
      resolvePeerRelationship({
        cachedContact: false,
        cachedBlocked: false,
        liveContact: undefined,
        liveBlocked: undefined,
      }),
    ).toBe('stranger');
  });

  it('keeps unresolved relationships hidden', () => {
    expect(
      resolvePeerRelationship({
        cachedContact: false,
        cachedBlocked: undefined,
        liveContact: undefined,
        liveBlocked: undefined,
      }),
    ).toBe('unknown');
  });

  it('lets live query results replace the cached snapshot', () => {
    expect(
      resolvePeerRelationship({
        cachedContact: false,
        cachedBlocked: false,
        liveContact: true,
        liveBlocked: false,
      }),
    ).toBe('contact');
  });

  it('gives blocking precedence over contact membership', () => {
    expect(
      resolvePeerRelationship({
        cachedContact: true,
        cachedBlocked: false,
        liveContact: true,
        liveBlocked: true,
      }),
    ).toBe('blocked');
  });
});
