import { Image, type ImageRef } from 'expo-image';
import { createVideoPlayer, type VideoThumbnail } from 'expo-video';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { fileSystemAdapter as files } from './file-system';

import type { VideoThumbnailPort } from '../ports/video-thumbnail';

async function savePoster(thumbnail: VideoThumbnail, target: string): Promise<string | undefined> {
  const context = ImageManipulator.manipulate(thumbnail);
  try {
    const scale = Math.min(1, 512 / Math.max(thumbnail.width, thumbnail.height));
    context.resize({ width: Math.max(1, Math.round(thumbnail.width * scale)) });
    const image = await context.renderAsync();
    try {
      const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
      try {
        await files.move(saved.uri, target);
        return target;
      } finally {
        await files.delete(saved.uri, { idempotent: true }).catch(() => {});
      }
    } finally {
      image.release();
    }
  } catch {
    return undefined;
  } finally {
    context.release();
  }
}

export const videoThumbnailAdapter: VideoThumbnailPort = {
  async generateMetadata(uri, options) {
    const player = createVideoPlayer(null);
    try {
      // SDK 57 documents replaceAsync as the non-blocking iOS loading path.
      await player.replaceAsync(uri);
      const [thumbnail] = await player.generateThumbnailsAsync(0);
      if (!thumbnail) return undefined;
      try {
        const posterUri = options?.posterUri
          ? await savePoster(thumbnail, options.posterUri).catch(() => undefined) : undefined;
        const thumbhash = options?.includeThumbhash === false ? undefined
          : await Image.generateThumbhashAsync(thumbnail as unknown as ImageRef).catch(() => undefined);
        return { width: thumbnail.width, height: thumbnail.height, thumbhash, posterUri };
      } finally {
        thumbnail.release();
      }
    } catch {
      return undefined;
    } finally {
      player.release();
    }
  },
};
