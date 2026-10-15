import { platform } from '@/platform';
import { fetchBlob } from '../artifacts';
import type { NappletRelease } from '../protocol';

jest.mock('@/platform', () => ({
  platform: {
    napplet: { fetchResource: jest.fn() },
    deviceCrypto: { sha256Hex: jest.fn() },
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
