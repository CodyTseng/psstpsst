import { electronFileSystemAdapter as files } from '../file-system';
import { electronImageCacheAdapter as cache } from '../image-cache';

jest.mock('../file-system', () => ({ electronFileSystemAdapter: {
  cacheDirectoryUri: jest.fn(async () => 'psstpsst-file://cache/'),
  stat: jest.fn(async () => ({ exists: false })),
  makeDirectory: jest.fn(async () => {}),
  downloadFile: jest.fn(async () => {}),
  move: jest.fn(async () => {}),
  delete: jest.fn(async () => {}),
} }));

afterEach(() => jest.clearAllMocks());

it('does not request a URL when checking local files', async () => {
  expect(await cache.getCachedUri('https://example.com/sticker.svg')).toBeNull();
  expect(files.downloadFile).not.toHaveBeenCalled();
  expect(files.stat).toHaveBeenCalledWith(expect.stringMatching(/^psstpsst-file:\/\/cache\/remote-images\/[a-f0-9]+\.svg$/));
});

it('publishes only complete downloads', async () => {
  const uri = await cache.download('https://example.com/sticker.png');
  expect(files.downloadFile).toHaveBeenCalledWith('https://example.com/sticker.png', `${uri}.partial`, { idempotent: true });
  expect(files.move).toHaveBeenCalledWith(`${uri}.partial`, uri);
  expect(files.delete).toHaveBeenCalledWith(`${uri}.partial`, { idempotent: true });
});

it('does not publish an interrupted file', async () => {
  jest.mocked(files.downloadFile).mockRejectedValueOnce(new Error('offline'));
  await expect(cache.download('https://example.com/sticker.png')).rejects.toThrow('offline');
  expect(files.move).not.toHaveBeenCalled();
  expect(files.delete).toHaveBeenCalled();
});
