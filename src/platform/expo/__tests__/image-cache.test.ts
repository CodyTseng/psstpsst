import { Image } from 'expo-image';
import { imageCacheAdapter } from '../image-cache';

jest.mock('expo-image', () => ({ Image: {
  getCachePathAsync: jest.fn(), prefetch: jest.fn(),
} }));

it('checks local image bytes without prefetching', async () => {
  jest.mocked(Image.getCachePathAsync).mockResolvedValue('/cache/sticker.png');
  expect(await imageCacheAdapter.getCachedUri('https://example.com/sticker.png')).toBe('file:///cache/sticker.png');
  expect(Image.prefetch).not.toHaveBeenCalled();
  jest.mocked(Image.getCachePathAsync).mockResolvedValue(null);
  expect(await imageCacheAdapter.getCachedUri('https://example.com/missing.png')).toBeNull();
  expect(Image.prefetch).not.toHaveBeenCalled();
});

it('returns only a local file after an authorized download completes', async () => {
  jest.mocked(Image.prefetch).mockResolvedValue(true);
  jest.mocked(Image.getCachePathAsync).mockResolvedValue('/cache/downloaded.png');
  expect(await imageCacheAdapter.download('https://example.com/sticker.png')).toBe('file:///cache/downloaded.png');
  expect(Image.prefetch).toHaveBeenCalledWith('https://example.com/sticker.png', 'disk');
});
