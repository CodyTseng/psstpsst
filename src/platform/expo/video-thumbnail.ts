import { Image, type ImageRef } from 'expo-image';
import { createVideoPlayer } from 'expo-video';

import type { VideoThumbnailPort } from '../ports/video-thumbnail';

export const videoThumbnailAdapter: VideoThumbnailPort = {
  async generateThumbhash(uri) {
    const player = createVideoPlayer(null);
    try {
      // SDK 57 documents replaceAsync as the non-blocking iOS loading path.
      await player.replaceAsync(uri);
      const [thumbnail] = await player.generateThumbnailsAsync(0);
      if (!thumbnail) return undefined;
      return await Image.generateThumbhashAsync(thumbnail as unknown as ImageRef);
    } catch {
      return undefined;
    } finally {
      player.release();
    }
  },
};
