import {
  isMessageOrderNewer,
  isRumorTooFarInFuture,
  messageOrderAt,
} from '../message-order';

describe('message order', () => {
  it('normalizes the authenticated millisecond tag', () => {
    expect(messageOrderAt({ created_at: 10, tags: [['ms', '321']] })).toBe(10_321);
  });

  it('falls back to the second floor for an invalid millisecond tag', () => {
    expect(messageOrderAt({ created_at: 10, tags: [['ms', '1000']] })).toBe(10_000);
  });

  it('treats the smaller event id as newer when timestamps tie', () => {
    expect(
      isMessageOrderNewer(
        { orderAt: 10_000, id: 'id-a' },
        { orderAt: 10_000, id: 'id-z' },
      ),
    ).toBe(true);
    expect(
      isMessageOrderNewer(
        { orderAt: 10_000, id: 'id-z' },
        { orderAt: 10_000, id: 'id-a' },
      ),
    ).toBe(false);
  });

  it('prefers a later timestamp regardless of event id', () => {
    expect(
      isMessageOrderNewer(
        { orderAt: 10_001, id: 'id-z' },
        { orderAt: 10_000, id: 'id-a' },
      ),
    ).toBe(true);
  });

  it('rejects only inner rumors more than ten minutes in the future', () => {
    const now = 1_000_000;
    expect(isRumorTooFarInFuture({ created_at: 1_600 }, now)).toBe(false);
    expect(isRumorTooFarInFuture({ created_at: 1_601 }, now)).toBe(true);
  });
});
