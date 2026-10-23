import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { finalizeEvent, generateSecretKey } from 'nostr-tools';
import { platform } from '@/platform';
import { applicationIconKey, loadApplicationIcon } from '../icons';
import { applicationListEntry, applicationPresentation, parseSite } from '../model';

jest.mock('@/platform', () => ({ platform: {
  napplet: { fetchResource: jest.fn() },
  deviceCrypto: { sha256Hex: jest.fn() },
  fileSystem: { documentDirectoryUri: jest.fn(async () => 'file:///documents/'),
    makeDirectory: jest.fn(async () => {}), stat: jest.fn(async () => ({ exists: false })),
    readBytes: jest.fn(), writeBytes: jest.fn(async () => {}), updateJson: jest.fn(async () => {}),
  },
} }));
const encode = (value: string) => new TextEncoder().encode(value);
const hash = (bytes: Uint8Array) => bytesToHex(sha256(bytes));
const image = encode('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"></svg>');
const signer = generateSecretKey();
let version = 0;
const fetchResource = jest.mocked(platform.napplet.fetchResource);
function site(assets: Record<string, Uint8Array>, tags: string[][] = [], name = 'site') {
  const files = { '/index.html': encode(''), ...assets };
  const blobs = new Map(Object.values(files).map(bytes => [hash(bytes), bytes]));
  const event = finalizeEvent({ kind: 35128, created_at: ++version, content: '', tags: [
    ['d', name], ['server', 'https://blobs.example/'],
    ...Object.entries(files).map(([path, bytes]) => ['path', path, hash(bytes)]), ...tags,
  ] }, signer);
  fetchResource.mockImplementation(async url => {
    const bytes = blobs.get(new URL(url).pathname.slice(1));
    if (!bytes) throw new Error('not-found');
    return bytes;
  });
  return { entry: parseSite(event), blobs };
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(platform.fileSystem.stat).mockResolvedValue({ exists: false } as never);
  jest.mocked(platform.deviceCrypto.sha256Hex).mockImplementation(async bytes => hash(bytes));
});

it.each([
  ['/brand.svg', image, 'image/svg+xml'],
  ['/brand.ico', new Uint8Array([0, 0, 1, 0, 1, 0]), 'image/x-icon'],
] as const)('loads explicit %s artwork before downloading any HTML', async (path, bytes, mime) => {
  const { entry } = site({ [path]: bytes }, [['icon', path]]);
  expect(entry.icon?.mime).toBe(mime);
  expect(await loadApplicationIcon(entry)).toBe(`data:${mime};base64,${Buffer.from(bytes).toString('base64')}`);
  expect(fetchResource).toHaveBeenCalledTimes(1);
  expect(fetchResource.mock.calls[0][0]).toBe(`https://blobs.example/${hash(bytes)}`);
});

it('uses one conventional icon without reading HTML or a web manifest', async () => {
  const html = encode('<link rel="icon" sizes="32x32" href="/small.svg"><link rel="manifest" href="/assets/app.webmanifest">');
  const manifest = encode(JSON.stringify({ icons: [{ src: 'large.svg', sizes: '512x512' }] }));
  const { entry } = site({ '/index.html': html, '/assets/app.webmanifest': manifest, '/assets/large.svg': image,
    '/favicon.svg': image, '/favicon.ico': new Uint8Array([0, 0, 1, 0, 1, 0]), '/small.svg': encode('<svg></svg>') });
  const first = loadApplicationIcon(entry);
  expect(loadApplicationIcon(applicationPresentation(entry))).toBe(first);
  expect(await first).toMatch(/^data:image\/svg\+xml;base64,/);
  expect(fetchResource.mock.calls.map(([url]) => url)).toEqual([`https://blobs.example/${hash(image)}`]);
  expect(platform.deviceCrypto.sha256Hex).toHaveBeenCalledTimes(1);
});

it('uses a signed favicon without following HTML or manifest icon references', async () => {
  const html = encode('<link rel="icon" sizes="2048x2048" href="https://outside.example/icon.svg"><link rel="icon" href="/unsigned.svg"><link rel="manifest" href="/manifest.json">');
  const manifest = encode(JSON.stringify({ icons: [{ src: 'https://outside.example/large.svg', sizes: '512x512' }, { src: '/missing.svg', sizes: '192x192' }] }));
  const ico = new Uint8Array([0, 0, 1, 0, 1, 0]);
  const { entry } = site({ '/index.html': html, '/manifest.json': manifest, '/favicon.ico': ico });
  expect(await loadApplicationIcon(entry)).toMatch(/^data:image\/x-icon;base64,/);
  expect(fetchResource.mock.calls.map(([url]) => url)).toEqual([`https://blobs.example/${hash(ico)}`]);
});

it('falls back without trying another icon when the selected file is corrupt', async () => {
  const { entry, blobs } = site({ '/favicon.svg': image, '/favicon.ico': new Uint8Array([0, 0, 1, 0, 1, 0]) });
  blobs.set(hash(image), encode('<svg>tampered</svg>'));
  expect(await loadApplicationIcon(entry)).toBeUndefined();
  expect(fetchResource).toHaveBeenCalledTimes(1);
  expect(platform.fileSystem.writeBytes).not.toHaveBeenCalled();
  expect(await loadApplicationIcon(entry)).toBeUndefined();
  expect(fetchResource).toHaveBeenCalledTimes(1);
});

it('uses the fallback without downloading when only metadata references an icon', async () => {
  const { entry } = site({ '/index.html': encode('<link rel="icon" href="/brand.svg">'), '/brand.svg': image,
    '/manifest.json': encode(JSON.stringify({ icons: [{ src: '/brand.svg' }] })) });
  expect(await loadApplicationIcon(entry)).toBeUndefined();
  expect(fetchResource).not.toHaveBeenCalled();
});

it('does not probe conventional icons when a declared icon fails', async () => {
  const broken = encode('<svg>broken</svg>');
  const { entry, blobs } = site({ '/brand.svg': broken, '/favicon.svg': image }, [['icon', '/brand.svg']]);
  blobs.delete(hash(broken));
  expect(await loadApplicationIcon(entry)).toBeUndefined();
  expect(fetchResource).toHaveBeenCalledTimes(1);
});

it('rejects non-image content at a conventional icon path', async () => {
  const { entry } = site({ '/favicon.svg': encode('<html>not an image</html>') });
  expect(await loadApplicationIcon(entry)).toBeUndefined();
  expect(fetchResource).toHaveBeenCalledTimes(1);
});

it('invalidates icon discovery for an updated signed manifest at the same address', async () => {
  const first = site({ '/favicon.svg': image }, [], 'updated');
  await loadApplicationIcon(first.entry);
  const changed = encode('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"></svg>');
  const second = site({ '/favicon.svg': changed }, [], 'updated');
  expect(second.entry.key).toBe(first.entry.key);
  expect(applicationIconKey(second.entry)).not.toBe(applicationIconKey(first.entry));
  expect(await loadApplicationIcon(second.entry)).toBe(`data:image/svg+xml;base64,${Buffer.from(changed).toString('base64')}`);
});

it('preserves the signed file map through both presentation adapters', () => {
  const { entry } = site({ '/favicon.svg': image });
  for (const presentation of [applicationPresentation(entry), applicationListEntry(entry)]) {
    expect(presentation.files).toBe(entry.files);
    expect(presentation.manifest).toBe(entry.manifest);
    expect(applicationIconKey(presentation)).toBe(entry.manifest?.id);
  }
});

it('reuses hash-verified bundle files already cached by the runtime', async () => {
  const { entry, blobs } = site({ '/favicon.svg': image });
  jest.mocked(platform.fileSystem.stat).mockImplementation(async path => {
    const bytes = blobs.get(path.split('/').at(-1)!.replace(/\.blob$/, ''));
    return { exists: !!bytes, size: bytes?.length ?? null } as never;
  });
  jest.mocked(platform.fileSystem.readBytes).mockImplementation(async path => blobs.get(path.split('/').at(-1)!.replace(/\.blob$/, ''))!);
  expect(await loadApplicationIcon(entry)).toMatch(/^data:image\/svg\+xml;base64,/);
  expect(fetchResource).not.toHaveBeenCalled();
  expect(platform.deviceCrypto.sha256Hex).toHaveBeenCalledTimes(1);
});
