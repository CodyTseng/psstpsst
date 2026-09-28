import { conversationTargetFromRoute } from '../target';

const PUBKEY = 'a'.repeat(64);
const GROUP_KEY = `group:${'b'.repeat(64)}`;

describe('conversationTargetFromRoute', () => {
  it('keeps a relay direct conversation addressed by its conversation key', () => {
    expect(
      conversationTargetFromRoute({ key: PUBKEY, transport: 'relay' }),
    ).toEqual({
      deliveryKind: 'relay',
      conversationKey: PUBKEY,
    });
  });

  it('marks a relay group while preserving its conversation key', () => {
    expect(
      conversationTargetFromRoute({ key: GROUP_KEY, transport: 'relay' }),
    ).toEqual({
      deliveryKind: 'relay',
      conversationKey: GROUP_KEY,
      group: true,
    });
  });

  it('keeps a Nearby conversation addressed by its conversation key', () => {
    expect(
      conversationTargetFromRoute({ key: PUBKEY, transport: 'proximity' }),
    ).toEqual({
      deliveryKind: 'proximity',
      conversationKey: PUBKEY,
    });
  });

  it('rejects unsupported Nearby group targets', () => {
    expect(
      conversationTargetFromRoute({ key: GROUP_KEY, transport: 'proximity' }),
    ).toBeNull();
  });
});
