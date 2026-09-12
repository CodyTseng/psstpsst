const MAX_DEEP_LINK_LENGTH = 8 * 1024;

/** Convert the registered desktop protocol into a safe Expo Router location. */
export function normalizeDesktopDeepLink(value: string): string | null {
  if (!value || value.length > MAX_DEEP_LINK_LENGTH) return null;
  const rawPath = value.split(/[?#]/, 1)[0];
  if (/(?:^|\/)(?:\.{1,2}|%2e(?:%2e)?)(?:\/|$)/i.test(rawPath)) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'psstpsst:' || url.username || url.password || url.port || url.hash) {
    return null;
  }

  const encodedSegments = [url.hostname, ...url.pathname.split('/')].filter(Boolean);
  if (encodedSegments.length === 0) return '/';
  const segments: string[] = [];
  for (const encoded of encodedSegments) {
    let segment: string;
    try {
      segment = decodeURIComponent(encoded);
    } catch {
      return null;
    }
    if (!segment || segment === '.' || segment === '..' || /[\\\0/]/.test(segment)) return null;
    segments.push(encodeURIComponent(segment));
  }
  return `/${segments.join('/')}${url.search}`;
}
