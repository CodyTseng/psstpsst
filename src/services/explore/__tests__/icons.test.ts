import { platform } from '@/platform';
import { loadWebsiteIcon, websiteIconOrigin } from '../icons';

jest.mock('@/platform', () => ({ platform: { napplet: { fetchResource: jest.fn() } } }));
const encode = (value: string) => new TextEncoder().encode(value);
const image = encode('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"></svg>');
const fetchResource = jest.mocked(platform.napplet.fetchResource);
beforeEach(() => fetchResource.mockReset());
afterEach(() => jest.restoreAllMocks());

it('uses canonical website origins and ignores signed application identifiers', () => {
  expect(websiteIconOrigin({ key: 'https://EXAMPLE.com/path?q=1' })).toBe('https://example.com');
  expect(websiteIconOrigin({ origin: 'https://site.example:8443/path' })).toBe('https://site.example:8443');
  for (const key of ['naddr1test', '35129:publisher:app', 'file:///private/icon', 'https://user:pass@site.example']) {
    expect(websiteIconOrigin({ key })).toBeUndefined();
  }
});

it('prefers the largest manifest icon over touch icons and small favicons', async () => {
  const origin = 'https://high-resolution.example';
  fetchResource.mockImplementation(async url => {
    if (url === `${origin}/`) return encode(`<link rel="icon" sizes="32x32" href="/favicon.png"><link rel='apple-touch-icon' sizes='180x180' href='/touch.png'><link rel=manifest href=/assets/site.webmanifest>`);
    if (url.endsWith('site.webmanifest')) return encode(JSON.stringify({ icons: [
      { src: 'small.png', sizes: '192x192' }, { src: 'large.png', sizes: '512x512' },
    ] }));
    if (url === `${origin}/assets/large.png`) return image;
    throw new Error(`unexpected-resource: ${url}`);
  });
  expect(await loadWebsiteIcon(origin)).toMatch(/^data:image\/svg\+xml;base64,/);
  expect(fetchResource.mock.calls.map(([url]) => url)).toEqual([`${origin}/`, `${origin}/assets/site.webmanifest`, `${origin}/assets/large.png`]);
});

it('deduplicates concurrent requests and shares results across paths on one origin', async () => {
  const origin = 'https://deduplicated.example';
  fetchResource.mockImplementation(async url => url === `${origin}/` ? encode('<link rel="apple-touch-icon" href="/touch.png">') : image);
  const first = loadWebsiteIcon(`${origin}/one`);
  expect(loadWebsiteIcon(`${origin}/two`)).toBe(first);
  await first;
  await loadWebsiteIcon(origin);
  expect(fetchResource).toHaveBeenCalledTimes(2);
});

it('tries a smaller declared icon when a high-resolution candidate fails', async () => {
  const origin = 'https://fallback.example';
  fetchResource.mockImplementation(async url => {
    if (url === `${origin}/`) return encode('<link rel="icon" sizes="512x512" href="/missing.png"><link rel="apple-touch-icon" sizes="180x180" href="/touch.png">');
    if (url.endsWith('/touch.png')) return image;
    throw new Error('not-found');
  });
  expect(await loadWebsiteIcon(origin)).toMatch(/^data:image/);
  expect(fetchResource.mock.calls.map(([url]) => url)).toEqual([`${origin}/`, `${origin}/missing.png`, `${origin}/touch.png`]);
});

it('accepts a conventional ICO when page metadata and touch icons are unavailable', async () => {
  const origin = 'https://conventional.example';
  fetchResource.mockImplementation(async url => {
    if (url.endsWith('/favicon.ico')) return new Uint8Array([0, 0, 1, 0, 1, 0]);
    throw new Error('not-found');
  });
  expect(await loadWebsiteIcon(origin)).toMatch(/^data:image\/x-icon;base64,/);
});

it('caches unavailable icons briefly and retries after expiry', async () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(1000000);
  const origin = 'https://unavailable.example';
  fetchResource.mockResolvedValue(encode('<html>not an image</html>'));
  expect(await loadWebsiteIcon(origin)).toBeUndefined();
  const attempts = fetchResource.mock.calls.length;
  expect(await loadWebsiteIcon(origin)).toBeUndefined();
  expect(fetchResource).toHaveBeenCalledTimes(attempts);
  now.mockReturnValue(1000000 + 5 * 60000 + 1);
  expect(await loadWebsiteIcon(origin)).toBeUndefined();
  expect(fetchResource).toHaveBeenCalledTimes(attempts * 2);
});

it('limits concurrent website discovery to four requests', async () => {
  const pending: (() => void)[] = [];
  fetchResource.mockImplementation(async url => {
    if (new URL(url).pathname === '/') await new Promise<void>(resolve => pending.push(resolve));
    return new URL(url).pathname === '/' ? encode('') : image;
  });
  const results = Array.from({ length: 8 }, (_, index) => loadWebsiteIcon(`https://queued-${index}.example`));
  expect(pending).toHaveLength(4);
  pending.splice(0).forEach(resolve => resolve());
  await Promise.all(results.slice(0, 4));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(pending).toHaveLength(4);
  pending.splice(0).forEach(resolve => resolve());
  expect((await Promise.all(results)).every(Boolean)).toBe(true);
});
