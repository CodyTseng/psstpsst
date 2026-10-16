import { platform } from '@/platform';
import { fetchBlob, loadArtifact } from '../artifacts';
import type { NappletRelease } from '../protocol';

jest.mock('@/platform', () => ({
  platform: {
    napplet: { fetchResource: jest.fn() },
    deviceCrypto: { sha256Hex: jest.fn() },
    fileSystem: {
      documentDirectoryUri: jest.fn(async () => 'file:///documents/'),
      makeDirectory: jest.fn(async () => {}), stat: jest.fn(), readBytes: jest.fn(), writeBytes: jest.fn(async () => {}),
    },
  },
}));

const hash = 'a'.repeat(64);
const release = {
  servers: ['https://first.example/', 'https://second.example/'],
} as NappletRelease;
const fetchResource = jest.mocked(platform.napplet.fetchResource);
const sha256Hex = jest.mocked(platform.deviceCrypto.sha256Hex);

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(platform.fileSystem.documentDirectoryUri).mockResolvedValue('file:///documents/');
});

test.each(['missing', 'corrupt'] as const)('shows download status only after a %s local artifact needs the network', async (cache) => {
  const bytes = new TextEncoder().encode('<main>App</main>');
  jest.mocked(platform.fileSystem.stat).mockResolvedValue({ exists: cache === 'corrupt' } as never);
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
