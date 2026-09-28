import { isMessageOrderNewer, messageOrderAt } from '../message-order';

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
});
