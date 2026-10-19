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
    readBytes: jest.fn(), writeBytes: jest.fn(async () => {}),
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

it('discovers the highest-resolution icon from verified HTML and a relative web manifest', async () => {
  const html = encode('<link rel="icon" sizes="32x32" href="/small.svg"><link rel="manifest" href="/assets/app.webmanifest">');
  const manifest = encode(JSON.stringify({ icons: [{ src: 'large.svg', sizes: '512x512' }] }));
  const { entry } = site({ '/index.html': html, '/assets/app.webmanifest': manifest, '/assets/large.svg': image, '/small.svg': encode('<svg></svg>') });
  const first = loadApplicationIcon(entry);
  expect(loadApplicationIcon(applicationPresentation(entry))).toBe(first);
  expect(await first).toMatch(/^data:image\/svg\+xml;base64,/);
  expect(fetchResource.mock.calls.map(([url]) => url)).toEqual([html, manifest, image].map(bytes => `https://blobs.example/${hash(bytes)}`));
  expect(platform.deviceCrypto.sha256Hex).toHaveBeenCalledTimes(3);
});

it('never fetches external or unsigned HTML and manifest icon references', async () => {
  const html = encode('<link rel="icon" sizes="2048x2048" href="https://outside.example/icon.svg"><link rel="icon" href="/unsigned.svg"><link rel="manifest" href="/manifest.json">');
  const manifest = encode(JSON.stringify({ icons: [{ src: 'https://outside.example/large.svg', sizes: '512x512' }, { src: '/missing.svg', sizes: '192x192' }] }));
  const ico = new Uint8Array([0, 0, 1, 0, 1, 0]);
  const { entry } = site({ '/index.html': html, '/manifest.json': manifest, '/favicon.ico': ico });
  expect(await loadApplicationIcon(entry)).toMatch(/^data:image\/x-icon;base64,/);
  expect(fetchResource.mock.calls.map(([url]) => url)).toEqual([html, manifest, ico].map(bytes => `https://blobs.example/${hash(bytes)}`));
});

it('rejects a corrupt high-resolution image and uses the next verified candidate', async () => {
  const html = encode('<link rel="icon" sizes="512x512" href="/large.svg"><link rel="icon" sizes="192x192" href="/small.svg">');
  const small = encode('<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192"></svg>');
  const { entry, blobs } = site({ '/index.html': html, '/large.svg': image, '/small.svg': small });
  blobs.set(hash(image), encode('<svg>tampered</svg>'));
  const uri = await loadApplicationIcon(entry);
  expect(uri).toBe(`data:image/svg+xml;base64,${Buffer.from(small).toString('base64')}`);
});

it('discovers conventional signed icon paths without HTML icon declarations', async () => {
  const { entry } = site({ '/favicon.svg': image });
  expect(await loadApplicationIcon(entry)).toMatch(/^data:image\/svg\+xml;base64,/);
  expect(fetchResource.mock.calls.at(-1)?.[0]).toBe(`https://blobs.example/${hash(image)}`);
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
  const html = encode('<link rel="icon" sizes="512x512" href="/cached.svg">');
  const { entry, blobs } = site({ '/index.html': html, '/cached.svg': image });
  jest.mocked(platform.fileSystem.stat).mockImplementation(async path => {
    const bytes = blobs.get(path.split('/').at(-1)!.replace(/\.blob$/, ''));
    return { exists: !!bytes, size: bytes?.length ?? null } as never;
  });
  jest.mocked(platform.fileSystem.readBytes).mockImplementation(async path => blobs.get(path.split('/').at(-1)!.replace(/\.blob$/, ''))!);
  expect(await loadApplicationIcon(entry)).toMatch(/^data:image\/svg\+xml;base64,/);
  expect(fetchResource).not.toHaveBeenCalled();
  expect(platform.deviceCrypto.sha256Hex).toHaveBeenCalledTimes(2);
});
