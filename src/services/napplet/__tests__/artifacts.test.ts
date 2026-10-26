import { platform } from '@/platform';
import { fetchBlob, loadArtifact, loadIcon, loadSiteBlob, recordArtifactVersion, recordArtifactIcon, readArtifactMetadata } from '../artifacts';
import { updateJson } from '@/platform/shared/update-json';
import type { NappletRelease } from '../protocol';
import { naddrEncode } from 'nostr-tools/nip19';

jest.mock('@/platform', () => ({
  platform: {
    napplet: { fetchResource: jest.fn() },
    deviceCrypto: { sha256Hex: jest.fn() },
    fileSystem: {
      documentDirectoryUri: jest.fn(async () => 'file:///documents/'),
      makeDirectory: jest.fn(async () => {}), stat: jest.fn(), readBytes: jest.fn(), readText: jest.fn(), writeBytes: jest.fn(async () => {}), writeText: jest.fn(async () => {}), updateJson: jest.fn(async () => {}),
    },
  },
}));

const hash = 'a'.repeat(64);
const release = {
  key: `35129:${'b'.repeat(64)}:demo`,
  event: { kind: 35129, pubkey: 'b'.repeat(64), tags: [['d', 'demo']], id: 'c'.repeat(64) },
  servers: ['https://first.example/', 'https://second.example/'],
} as NappletRelease;
const appId = naddrEncode({ kind: 35129, pubkey: 'b'.repeat(64), identifier: 'demo' });
const directory = `file:///documents/app-artifacts/${appId}/files`;
const fetchResource = jest.mocked(platform.napplet.fetchResource);
const sha256Hex = jest.mocked(platform.deviceCrypto.sha256Hex);

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(platform.fileSystem.documentDirectoryUri).mockResolvedValue('file:///documents/');
});

test.each(['missing', 'corrupt'] as const)('shows download status only after a %s local artifact needs the network', async (cache) => {
  const bytes = new TextEncoder().encode('<main>App</main>');
  jest.mocked(platform.fileSystem.stat).mockImplementation(async path => ({ exists: cache === 'corrupt' && path.startsWith(directory) }) as never);
  jest.mocked(platform.fileSystem.readBytes).mockResolvedValue(new Uint8Array([0]));
  if (cache === 'corrupt') sha256Hex.mockResolvedValueOnce('b'.repeat(64));
  sha256Hex.mockResolvedValue(hash);
  const downloading = jest.fn();
  fetchResource.mockImplementation(async () => {
    expect(downloading).toHaveBeenCalledTimes(1);
    return bytes;
  });
  await expect(loadArtifact({ ...release, hash }, undefined, downloading)).resolves.toBe('<main>App</main>');
  expect(downloading).toHaveBeenCalledTimes(1);
});

test('keeps cached launches quiet after verifying their local bytes', async () => {
  jest.mocked(platform.fileSystem.stat).mockResolvedValue({ exists: true } as never);
  jest.mocked(platform.fileSystem.readBytes).mockResolvedValue(new TextEncoder().encode('<main>Cached</main>'));
  sha256Hex.mockResolvedValue(hash);
  const downloading = jest.fn();
  await expect(loadArtifact({ ...release, hash }, undefined, downloading)).resolves.toBe('<main>Cached</main>');
  expect(downloading).not.toHaveBeenCalled();
  expect(fetchResource).not.toHaveBeenCalled();
});

test('reports a missing native runtime instead of hiding it as a network failure', async () => {
  fetchResource.mockRejectedValue(new Error('napplets.rebuild_required'));
  await expect(fetchBlob(release, hash, 100)).rejects.toThrow('napplets.rebuild_required');
  expect(fetchResource).toHaveBeenCalledTimes(1);
});

test('tries the next signed server after a corrupt download', async () => {
  const corrupt = new Uint8Array([0]);
  const valid = new Uint8Array([1]);
  fetchResource.mockResolvedValueOnce(corrupt).mockResolvedValueOnce(valid);
  sha256Hex.mockResolvedValueOnce('b'.repeat(64)).mockResolvedValueOnce(hash);
  await expect(fetchBlob(release, hash, 100)).resolves.toBe(valid);
  expect(fetchResource).toHaveBeenLastCalledWith(`https://second.example/${hash}`, 100, undefined);
});

test('retains the underlying failure for diagnosis when all servers fail', async () => {
  const error = new Error('TLS connection failed');
  fetchResource.mockRejectedValue(error);
  await expect(fetchBlob(release, hash, 100)).rejects.toMatchObject({
    message: 'napplets.download_failed', cause: error,
  });
});

test('stops fallback immediately when the account operation is cancelled', async () => {
  const abort = new AbortController();
  fetchResource.mockImplementation(async () => {
    abort.abort();
    throw new Error('cancelled');
  });
  await expect(fetchBlob(release, hash, 100, abort.signal)).rejects.toThrow();
  expect(fetchResource).toHaveBeenCalledTimes(1);
});

test('verifies cached multi-file assets before reusing them',async()=>{
  const bytes=new Uint8Array([1,2,3]);
  jest.mocked(platform.fileSystem.stat).mockResolvedValue({exists:true} as never);
  jest.mocked(platform.fileSystem.readBytes).mockResolvedValue(bytes);
  sha256Hex.mockResolvedValue(hash);
  await expect(loadSiteBlob(release,hash)).resolves.toBe(bytes);
  expect(fetchResource).not.toHaveBeenCalled();
});


test('bounds icon cache reads and downloads without reading oversized cached assets', async () => {
  jest.mocked(platform.fileSystem.stat).mockResolvedValue({ exists: true, size: 1024 } as never);
  fetchResource.mockResolvedValue(new Uint8Array(1024));
  await expect(loadSiteBlob(release, hash, undefined, 100)).rejects.toThrow('napplets.download_failed');
  expect(platform.fileSystem.readBytes).not.toHaveBeenCalled();
  expect(fetchResource).toHaveBeenCalledWith(`https://first.example/${hash}`, 100, undefined);
});

test('stores the same asset in separate application directories', async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  jest.mocked(platform.fileSystem.stat).mockResolvedValue({ exists: false } as never);
  fetchResource.mockResolvedValue(bytes);
  sha256Hex.mockResolvedValue(hash);
  await loadSiteBlob(release, hash);
  const other = { ...release, key: `35129:${'b'.repeat(64)}:other` };
  await loadSiteBlob(other, hash);
  const otherId = naddrEncode({ kind: 35129, pubkey: 'b'.repeat(64), identifier: 'other' });
  expect(platform.fileSystem.writeBytes).toHaveBeenNthCalledWith(1, `${directory}/${hash}.blob`, bytes);
  expect(platform.fileSystem.writeBytes).toHaveBeenNthCalledWith(2, `file:///documents/app-artifacts/${otherId}/files/${hash}.blob`, bytes);
});

test('keeps the application directory stable across manifest updates', async () => {
  const bytes = new Uint8Array([1]);
  jest.mocked(platform.fileSystem.stat).mockResolvedValue({ exists: false } as never);
  fetchResource.mockResolvedValue(bytes);
  sha256Hex.mockResolvedValue(hash);
  const manifest = { kind: 35130, pubkey: 'b'.repeat(64), tags: [['d', 'demo']], id: 'c'.repeat(64) };
  const id = naddrEncode({ kind: manifest.kind, pubkey: manifest.pubkey, identifier: 'demo' });
  await loadSiteBlob({ servers: release.servers, manifest }, hash);
  await loadSiteBlob({ servers: release.servers, manifest: { ...manifest, id: 'd'.repeat(64) } }, hash);
  expect(platform.fileSystem.writeBytes).toHaveBeenNthCalledWith(1, `file:///documents/app-artifacts/${id}/files/${hash}.blob`, bytes);
  expect(platform.fileSystem.writeBytes).toHaveBeenNthCalledWith(2, `file:///documents/app-artifacts/${id}/files/${hash}.blob`, bytes);
});

test.each(['html', 'blob'] as const)('lazily copies verified legacy %s files without downloading', async extension => {
  const bytes = new TextEncoder().encode('<main>Cached</main>');
  jest.mocked(platform.fileSystem.stat).mockImplementation(async path => ({ exists: path === `file:///documents/napplets/${hash}.${extension}` }) as never);
  jest.mocked(platform.fileSystem.readBytes).mockResolvedValue(bytes);
  sha256Hex.mockResolvedValue(hash);
  if (extension === 'html') await expect(loadArtifact({ ...release, hash })).resolves.toBe('<main>Cached</main>');
  else await expect(loadSiteBlob(release, hash)).resolves.toBe(bytes);
  expect(platform.fileSystem.writeBytes).toHaveBeenCalledWith(`${directory}/${hash}.${extension}`, bytes);
  expect(fetchResource).not.toHaveBeenCalled();
});

test('does not copy corrupt legacy bytes into the application directory', async () => {
  const bytes = new Uint8Array([1]);
  jest.mocked(platform.fileSystem.stat).mockImplementation(async path => ({ exists: path.includes('/napplets/') }) as never);
  jest.mocked(platform.fileSystem.readBytes).mockResolvedValue(new Uint8Array([0]));
  sha256Hex.mockResolvedValueOnce('c'.repeat(64)).mockResolvedValue(hash);
  fetchResource.mockResolvedValue(bytes);
  await expect(loadSiteBlob(release, hash)).resolves.toBe(bytes);
  expect(platform.fileSystem.writeBytes).toHaveBeenCalledTimes(1);
  expect(platform.fileSystem.writeBytes).toHaveBeenCalledWith(`${directory}/${hash}.blob`, bytes);
});

test.each(['html', 'blob'] as const)('reuses verified %s files from the earlier application directory layout', async extension => {
  const bytes = new TextEncoder().encode('<main>Cached</main>');
  const previous = `file:///documents/app-artifacts/${appId}/${hash}.${extension}`;
  jest.mocked(platform.fileSystem.stat).mockImplementation(async path => ({ exists: path === previous }) as never);
  jest.mocked(platform.fileSystem.readBytes).mockResolvedValue(bytes);
  sha256Hex.mockResolvedValue(hash);
  if (extension === 'html') await expect(loadArtifact({ ...release, hash })).resolves.toBe('<main>Cached</main>');
  else await expect(loadSiteBlob(release, hash)).resolves.toBe(bytes);
  expect(platform.fileSystem.writeBytes).toHaveBeenCalledWith(`${directory}/${hash}.${extension}`, bytes);
  expect(fetchResource).not.toHaveBeenCalled();
});

test('encodes separators and case-sensitive identifiers into a portable naddr directory', async () => {
  const identifier = '../Demo:App/中文';
  const id = naddrEncode({ kind: 35129, pubkey: 'b'.repeat(64), identifier });
  jest.mocked(platform.fileSystem.stat).mockResolvedValue({ exists: true } as never);
  jest.mocked(platform.fileSystem.readBytes).mockResolvedValue(new Uint8Array([1]));
  sha256Hex.mockResolvedValue(hash);
  await loadSiteBlob({ ...release, key: `35129:${'b'.repeat(64)}:${identifier}` }, hash);
  expect(platform.fileSystem.makeDirectory).toHaveBeenCalledWith(`file:///documents/app-artifacts/${id}/files`, expect.anything());
  expect(id).toMatch(/^naddr1[0-9a-z]+$/);
});

test('bounds long directory names and retains the full application ID', async () => {
  const identifier = 'long'.repeat(40);
  const id = naddrEncode({ kind: 35129, pubkey: 'b'.repeat(64), identifier });
  expect(id.length).toBeGreaterThan(240);
  jest.mocked(platform.fileSystem.stat).mockResolvedValue({ exists: true } as never);
  jest.mocked(platform.fileSystem.readBytes).mockResolvedValue(new Uint8Array([1]));
  sha256Hex.mockResolvedValue(hash);
  await loadSiteBlob({ ...release, key: `35129:${'b'.repeat(64)}:${identifier}` }, hash);
  expect(platform.fileSystem.writeText).toHaveBeenCalledWith(`file:///documents/app-artifacts/app-${hash}/app-id.txt`, id);
});

test('persists declared icons inside their application directory', async () => {
  const bytes = new TextEncoder().encode('<svg></svg>');
  jest.mocked(platform.fileSystem.stat).mockResolvedValue({ exists: false } as never);
  fetchResource.mockResolvedValue(bytes);
  sha256Hex.mockResolvedValue(hash);
  await expect(loadIcon({ ...release, icon: { hash, mime: 'image/svg+xml' } })).resolves.toMatch(/^data:image\/svg\+xml;base64,/);
  expect(platform.fileSystem.writeBytes).toHaveBeenCalledWith(`${directory}/${hash}.blob`, bytes);
});

test('rejects invalid artifact hashes before accessing the filesystem', async () => {
  await expect(loadSiteBlob(release, '../outside')).rejects.toThrow('invalid-hash');
  expect(platform.fileSystem.makeDirectory).not.toHaveBeenCalled();
  expect(platform.fileSystem.stat).not.toHaveBeenCalled();
});

test('persists version progress and icon metadata without downgrading completed versions', async () => {
  let stored: string | null = null;
  jest.mocked(platform.fileSystem.updateJson).mockImplementation(async (uri, patch) => {
    expect(uri).toBe(`file:///documents/app-artifacts/${appId}/metadata.json`);
    await updateJson(uri, patch, async () => stored, async text => { stored = text; });
  });
  jest.mocked(platform.fileSystem.stat).mockResolvedValue({ exists: true, size: 1024 } as never);
  jest.mocked(platform.fileSystem.readText).mockImplementation(async () => stored!);
  const file = `files/${hash}.html`;
  await recordArtifactVersion(release, [file, file], false);
  expect((await readArtifactMetadata(release))?.versions[release.event.id]).toEqual({ files: [file] });
  await recordArtifactVersion(release, [file], true);
  await Promise.all([recordArtifactIcon(release, hash), recordArtifactVersion(release, [file], false)]);
  const metadata = await readArtifactMetadata(release);
  expect(metadata?.versions[release.event.id]).toEqual({ files: [file], complete: true });
  expect(metadata?.icon).toEqual({ path: `files/${hash}.blob`, sourceHash: hash, manifestId: release.event.id });
});

test('rejects unsafe file paths before updating metadata', async () => {
  await expect(recordArtifactVersion(release, ['../secrets'], true)).rejects.toThrow('invalid-artifact-files');
  expect(platform.fileSystem.updateJson).not.toHaveBeenCalled();
});

test.each([
  { schemaVersion: 2, appId, versions: {} },
  { schemaVersion: 1, appId: 'another-app', versions: {} },
  { schemaVersion: 1, appId, versions: { [release.event.id]: { files: ['../secrets'], complete: true } } },
  { schemaVersion: 1, appId, versions: {}, icon: { path: '../secrets', sourceHash: hash, manifestId: release.event.id } },
])('ignores invalid or incompatible local cache metadata: %j', async value => {
  jest.mocked(platform.fileSystem.stat).mockResolvedValue({ exists: true, size: 1024 } as never);
  jest.mocked(platform.fileSystem.readText).mockResolvedValue(JSON.stringify(value));
  await expect(readArtifactMetadata(release)).resolves.toBeUndefined();
  expect(fetchResource).not.toHaveBeenCalled();
});
