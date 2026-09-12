import { base64 } from '@scure/base';
import { rgbaToThumbHash } from 'thumbhash';

import type { VideoThumbnailPort } from '../ports/video-thumbnail';

const MAX_DIMENSION = 100;
const LOAD_TIMEOUT_MS = 10_000;

function waitForVideoFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => finish(new Error('Video thumbnail timed out')),
      LOAD_TIMEOUT_MS,
    );
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      video.removeEventListener('loadeddata', onLoaded);
      video.removeEventListener('error', onError);
      if (error) reject(error);
      else resolve();
    };
    const onLoaded = () => finish();
    const onError = () => finish(new Error('Video thumbnail could not be loaded'));
    video.addEventListener('loadeddata', onLoaded, { once: true });
    video.addEventListener('error', onError, { once: true });
    video.load();
  });
}

export const electronVideoThumbnailAdapter: VideoThumbnailPort = {
  async generateThumbhash(uri) {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.src = uri;
    try {
      await waitForVideoFrame(video);
      if (!video.videoWidth || !video.videoHeight) return undefined;
      const scale = Math.min(1, MAX_DIMENSION / Math.max(video.videoWidth, video.videoHeight));
      const width = Math.max(1, Math.round(video.videoWidth * scale));
      const height = Math.max(1, Math.round(video.videoHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return undefined;
      context.drawImage(video, 0, 0, width, height);
      return base64.encode(
        rgbaToThumbHash(width, height, context.getImageData(0, 0, width, height).data),
      );
    } catch {
      return undefined;
    } finally {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
  },
};
