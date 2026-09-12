import type { ImageCachePort } from '../ports/image-cache';

function imageModule() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('expo-image') as typeof import('expo-image')).Image;
}

export const imageCacheAdapter: ImageCachePort = {
  async getCachedUri(url) {
    const path = await imageModule().getCachePathAsync(url);
    return path ? (path.startsWith('/') ? `file://${path}` : path) : null;
  },
  async download(url) {
    const Image = imageModule();
    if (!await Image.prefetch(url, 'disk')) throw new Error('Image download failed');
    const uri = await imageCacheAdapter.getCachedUri(url);
    if (!uri) throw new Error('Downloaded image is unavailable');
    return uri;
  },
};
