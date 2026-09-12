import {
  isPrimaryPanePathname,
  pathnameFromHref,
  shouldResetPrimaryPaneDetail,
} from '../primary-pane-navigation';

describe('primary pane navigation', () => {
  it.each(['/', '/contacts', '/me'])('recognizes %s as a primary route', (pathname) => {
    expect(isPrimaryPanePathname(pathname)).toBe(true);
  });

  it('pushes the first wide detail so Back can reveal the placeholder', () => {
    expect(shouldResetPrimaryPaneDetail(true, '/me', null)).toBe(false);
  });

  it('resets any existing wide detail stack regardless of its owner', () => {
    expect(shouldResetPrimaryPaneDetail(true, '/chat/alice', null)).toBe(true);
    expect(shouldResetPrimaryPaneDetail(true, '/appearance', null)).toBe(true);
    expect(shouldResetPrimaryPaneDetail(true, '/profile/alice', null)).toBe(true);
  });

  it('treats a pending first detail as open before the URL catches up', () => {
    expect(shouldResetPrimaryPaneDetail(true, '/me', '/account')).toBe(true);
  });

  it('keeps compact navigation as ordinary pushes', () => {
    expect(shouldResetPrimaryPaneDetail(false, '/appearance', '/account')).toBe(false);
  });

  it('normalizes query and fragment state from pending hrefs', () => {
    expect(pathnameFromHref('/chat/alice?focus=event#message')).toBe('/chat/alice');
  });
});
