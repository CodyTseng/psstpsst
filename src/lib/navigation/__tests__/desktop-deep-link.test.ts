import { normalizeDesktopDeepLink } from '../desktop-deep-link';

describe('normalizeDesktopDeepLink', () => {
  it('maps host-style and path-style links to routes', () => {
    expect(normalizeDesktopDeepLink('psstpsst://chat/abc?reply=1')).toBe('/chat/abc?reply=1');
    expect(normalizeDesktopDeepLink('psstpsst:///welcome')).toBe('/welcome');
  });

  it('rejects other schemes and unsafe route segments', () => {
    expect(normalizeDesktopDeepLink('https://example.com/chat/abc')).toBeNull();
    expect(normalizeDesktopDeepLink('psstpsst://chat/%2E%2E/settings')).toBeNull();
    expect(normalizeDesktopDeepLink('psstpsst://chat/a%2Fb')).toBeNull();
    expect(normalizeDesktopDeepLink('psstpsst://chat/a%5Cb')).toBeNull();
  });

  it('rejects fragments, credentials, and oversized payloads', () => {
    expect(normalizeDesktopDeepLink('psstpsst://chat/abc#fragment')).toBeNull();
    expect(normalizeDesktopDeepLink('psstpsst://user@example.com/chat')).toBeNull();
    expect(normalizeDesktopDeepLink(`psstpsst://chat/${'a'.repeat(9000)}`)).toBeNull();
  });
});
