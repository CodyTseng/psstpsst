import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

import type { ImageCachePort } from '../ports/image-cache';
import { electronFileSystemAdapter as files } from './file-system';

async function cachePath(url: string) {
  const root = await files.cacheDirectoryUri();
  if (!root) throw new Error('Image cache is unavailable');
  const extension = new URL(url).pathname.match(/\.(?:png|jpe?g|gif|webp|avif|svg|heic|ico)$/i)?.[0] ?? '';
  return `${root}remote-images/${bytesToHex(sha256(utf8ToBytes(url)))}${extension}`;
}

export const electronImageCacheAdapter: ImageCachePort = {
  async getCachedUri(url) {
    const uri = await cachePath(url);
    return (await files.stat(uri)).exists ? uri : null;
  },
  async download(url) {
    const uri = await cachePath(url);
    await files.makeDirectory(uri.slice(0, uri.lastIndexOf('/')), { intermediates: true, idempotent: true });
    // Publish only complete files; interrupted downloads never count as cache hits.
    const staging = `${uri}.partial`;
    try {
      await files.downloadFile(url, staging, { idempotent: true });
      await files.move(staging, uri);
      return uri;
    } finally {
      await files.delete(staging, { idempotent: true }).catch(() => {});
    }
  },
};
