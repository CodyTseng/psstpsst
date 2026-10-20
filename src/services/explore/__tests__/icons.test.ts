import { platform } from '@/platform';
import { loadWebsiteIcon, websiteIconOrigin } from '../icons';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { subscribeWebsiteIcon, retryWebsiteIcon } from '../website-icons';

jest.mock('@/platform', () => {
  const stored = new Map<string, string | Uint8Array>();
  let serial = 0;
  const { updateJson } = jest.requireActual('@/platform/shared/update-json');
  return { platform: {
    napplet: { fetchResource: jest.fn(), fetchResourceResponse: undefined },
    deviceCrypto: { sha256Hex: jest.fn(async bytes => {
      const { sha256 } = jest.requireActual('@noble/hashes/sha2.js');
      const { bytesToHex } = jest.requireActual('@noble/hashes/utils.js');
      return bytesToHex(sha256(bytes));
    }), randomUUID: jest.fn(async () => `icon-${++serial}`) },
    imageManipulator: { getDimensions: jest.fn(async () => ({ width: 512, height: 512 })), renderAndSave: jest.fn(async () => {
      const uri = `file:///rendered-${++serial}.png`; stored.set(uri, new Uint8Array([137,80,78,71])); return { uri };
    }) },
    fileSystem: {
      stored,
      documentDirectoryUri: jest.fn(async () => 'file:///documents/'),
      makeDirectory: jest.fn(async () => {}),
      stat: jest.fn(async uri => ({ exists: stored.has(uri), isDirectory: false, size: stored.get(uri)?.length ?? null })),
      readText: jest.fn(async uri => stored.get(uri)),
      writeBytes: jest.fn(async (uri, bytes) => { stored.set(uri, bytes); }),
      copy: jest.fn(async (from, to) => { stored.set(to, stored.get(from)!); }),
      move: jest.fn(async (from, to) => { stored.set(to, stored.get(from)!); stored.delete(from); }),
      delete: jest.fn(async uri => { stored.delete(uri); }),
      updateJson: jest.fn(async (uri, patch) => updateJson(uri, patch, async () => stored.get(uri) ?? null, async (text: string) => { stored.set(uri, text); })),
    },
  } };
});
const encode = (value: string) => new TextEncoder().encode(value);
const image = encode('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"></svg>');
const fetchResource = jest.mocked(platform.napplet.fetchResource);
const stored = (platform.fileSystem as unknown as { stored: Map<string, string | Uint8Array> }).stored;
const hash = (value: string) => bytesToHex(sha256(encode(value)));
const directory = (origin: string) => `file:///documents/app-artifacts/website-${hash(origin)}`;
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));
async function until(condition: () => boolean) {
  for (let i = 0; i < 20 && !condition(); i++) await flush();
  expect(condition()).toBe(true);
}
beforeEach(() => { fetchResource.mockReset(); stored.clear(); jest.clearAllMocks(); platform.napplet.fetchResourceResponse = undefined; });
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
  expect(await loadWebsiteIcon(origin)).toMatch(/\/icon-[a-f0-9]{64}\.png$/);
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
  expect(await loadWebsiteIcon(origin)).toMatch(/\/icon-[a-f0-9]{64}\.png$/);
  expect(fetchResource.mock.calls.map(([url]) => url)).toEqual([`${origin}/`, `${origin}/missing.png`, `${origin}/touch.png`]);
});

it('accepts a conventional ICO when page metadata and touch icons are unavailable', async () => {
  const origin = 'https://conventional.example';
  fetchResource.mockImplementation(async url => {
    if (url.endsWith('/favicon.ico')) return new Uint8Array([0, 0, 1, 0, 1, 0]);
    throw new Error('not-found');
  });
  expect(await loadWebsiteIcon(origin)).toMatch(/\/icon-[a-f0-9]{64}\.png$/);
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
  await until(() => pending.length === 4);
  expect(pending).toHaveLength(4);
  pending.splice(0).forEach(resolve => resolve());
  await Promise.all(results.slice(0, 4));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(pending).toHaveLength(4);
  pending.splice(0).forEach(resolve => resolve());
  expect((await Promise.all(results)).every(Boolean)).toBe(true);
});

function seed(origin: string, fresh: boolean, iconUrl = `${origin}/saved.svg`) {
  const root = directory(origin);
  const sourceHash = hash('previous-icon');
  const path = `icon-${sourceHash}.png`;
  const metadata = { schemaVersion: 1, appId: origin, origin, checkedAt: Date.now() - 1000,
    refreshAfter: fresh ? Date.now() + 60000 : Date.now() - 1,
    icon: { path, sourceHash, url: iconUrl, etag: '"ExistingTag"', lastModified: 'Tue, 01 Jan 2030 00:00:00 GMT' } };
  stored.set(`${root}/metadata.json`, JSON.stringify(metadata));
  stored.set(`${root}/${path}`, new Uint8Array([137, 80, 78, 71]));
  return { root, path, uri: `${root}/${path}`, metadata };
}

it('reads a persisted icon on a cold start without downloading, rehashing pixels or converting', async () => {
  const origin = 'https://cold-start.example';
  const { uri } = seed(origin, true);
  expect(await loadWebsiteIcon(origin)).toBe(uri);
  expect(fetchResource).not.toHaveBeenCalled();
  expect(platform.deviceCrypto.sha256Hex).toHaveBeenCalledTimes(1);
  expect(platform.imageManipulator.renderAndSave).not.toHaveBeenCalled();
});

it('returns a stale icon immediately while conditional revalidation is pending', async () => {
  const origin = 'https://revalidate.example';
  const { uri, root, metadata } = seed(origin, false);
  let finish!: (response: { status: 304; bytes: Uint8Array }) => void;
  const fetchResponse = jest.fn(() => new Promise<{ status: 304; bytes: Uint8Array }>(resolve => { finish = resolve; }));
  platform.napplet.fetchResourceResponse = fetchResponse;
  expect(await loadWebsiteIcon(origin)).toBe(uri);
  expect(fetchResponse).toHaveBeenCalledWith(metadata.icon.url, 512 * 1024, expect.anything(), {
    etag: metadata.icon.etag, lastModified: metadata.icon.lastModified,
  });
  finish({ status: 304, bytes: new Uint8Array() });
  await until(() => JSON.parse(stored.get(`${root}/metadata.json`) as string).refreshAfter > Date.now());
  expect(stored.has(uri)).toBe(true);
  expect(platform.imageManipulator.renderAndSave).not.toHaveBeenCalled();
});

it('replaces a changed icon only after saving it and notifying the displayed row', async () => {
  const origin = 'https://updated-icon.example';
  const { uri, root } = seed(origin, false);
  const onIcon = jest.fn();
  const unsubscribe = subscribeWebsiteIcon(origin, onIcon);
  platform.napplet.fetchResourceResponse = jest.fn(async () => ({ status: 200 as const, bytes: image, etag: '"NewTag"' }));
  expect(await loadWebsiteIcon(origin)).toBe(uri);
  await until(() => !stored.has(uri));
  const metadata = JSON.parse(stored.get(`${root}/metadata.json`) as string);
  expect(metadata.icon.sourceHash).toBe(bytesToHex(sha256(image)));
  expect(metadata.icon.etag).toBe('"NewTag"');
  expect(metadata.icon.lastModified).toBeNull();
  expect(onIcon).toHaveBeenLastCalledWith(`${root}/${metadata.icon.path}`);
  expect(stored.has(`${root}/${metadata.icon.path}`)).toBe(true);
  expect([...stored.keys()].some(key => key.includes('icon-input-') || key.includes('icon-output-'))).toBe(false);
  unsubscribe();
});

it('keeps the persisted icon when offline and backs off retrying', async () => {
  const origin = 'https://offline-icon.example';
  const { uri, root } = seed(origin, false);
  fetchResource.mockRejectedValue(new Error('offline'));
  expect(await loadWebsiteIcon(origin)).toBe(uri);
  await until(() => JSON.parse(stored.get(`${root}/metadata.json`) as string).refreshAfter > Date.now());
  const attempts = fetchResource.mock.calls.length;
  expect(stored.has(uri)).toBe(true);
  expect(await loadWebsiteIcon(origin)).toBe(uri);
  expect(fetchResource).toHaveBeenCalledTimes(attempts);
});

it('rejects metadata paths outside the site directory and repairs missing icons', async () => {
  const origin = 'https://bad-path-icon.example';
  const { root, metadata } = seed(origin, true);
  stored.set(`${root}/metadata.json`, JSON.stringify({ ...metadata, icon: { ...metadata.icon, path: '../private.png' } }));
  fetchResource.mockImplementation(async url => url === `${origin}/` ? encode('') : image);
  const uri = await loadWebsiteIcon(origin);
  expect(uri).toMatch(new RegExp(`^${root}/icon-[a-f0-9]{64}\\.png$`));
  expect(fetchResource).toHaveBeenCalled();
});

it('redownloads a cached file rejected by the image decoder without entering an immediate retry loop', async () => {
  const origin = 'https://corrupt-file-icon.example';
  const { uri } = seed(origin, true);
  expect(await loadWebsiteIcon(origin)).toBe(uri);
  fetchResource.mockImplementation(async url => url === `${origin}/` ? encode('') : image);
  const next = await retryWebsiteIcon(origin, uri);
  expect(next).toMatch(/\/icon-[a-f0-9]{64}\.png$/);
  const attempts = fetchResource.mock.calls.length;
  expect(await retryWebsiteIcon(origin, next!)).toBeUndefined();
  expect(fetchResource).toHaveBeenCalledTimes(attempts);
});
