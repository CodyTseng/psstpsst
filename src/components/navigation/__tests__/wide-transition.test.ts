import { getPendingWideTransitionEndRouteKey } from '../wide-transition';

describe('wide transition completion', () => {
  it('does not publish a transition without an active route', () => {
    expect(getPendingWideTransitionEndRouteKey(null, undefined)).toBeNull();
  });

  it('publishes once while a route remains active', () => {
    expect(getPendingWideTransitionEndRouteKey(null, 'chat-alice')).toBe('chat-alice');
    expect(getPendingWideTransitionEndRouteKey('chat-alice', 'chat-alice')).toBeNull();
  });

  it('publishes again when Back reactivates a previous route', () => {
    expect(getPendingWideTransitionEndRouteKey('chat-alice', 'profile-bob')).toBe('profile-bob');
    expect(getPendingWideTransitionEndRouteKey('profile-bob', 'chat-alice')).toBe('chat-alice');
  });
});
