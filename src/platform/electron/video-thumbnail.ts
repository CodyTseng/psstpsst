import { base64 } from '@scure/base';
import { rgbaToThumbHash } from 'thumbhash';

import type { VideoThumbnailPort } from '../ports/video-thumbnail';
import { electronFileSystemAdapter as files } from './file-system';

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
  async generateMetadata(uri, options) {
    const video = document.createElement('video');
    video.muted = true;
    // Local media uses a different origin from the app; keep poster canvases readable.
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    video.src = uri;
    try {
      await waitForVideoFrame(video);
      if (!video.videoWidth || !video.videoHeight) return undefined;
      const dimensions = { width: video.videoWidth, height: video.videoHeight };
      let posterUri: string | undefined;
      try {
        const maxDimension = options?.posterUri ? 512 : MAX_DIMENSION;
        const scale = Math.min(1, maxDimension / Math.max(video.videoWidth, video.videoHeight));
        const width = Math.max(1, Math.round(video.videoWidth * scale));
        const height = Math.max(1, Math.round(video.videoHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return dimensions;
        context.drawImage(video, 0, 0, width, height);
        if (options?.posterUri) {
          const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
          if (blob) {
            await files.writeBytes(options.posterUri, new Uint8Array(await blob.arrayBuffer()));
            posterUri = options.posterUri;
          }
        }
        if (options?.includeThumbhash === false) return { ...dimensions, posterUri };
        if (maxDimension !== MAX_DIMENSION) {
          const scale = Math.min(1, MAX_DIMENSION / Math.max(video.videoWidth, video.videoHeight));
          canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
          canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
        }
        const thumbhash = base64.encode(rgbaToThumbHash(
          canvas.width, canvas.height, context.getImageData(0, 0, canvas.width, canvas.height).data,
        ));
        return { ...dimensions, thumbhash, posterUri };
      } catch {
        return { ...dimensions, posterUri };
      }
    } catch {
      return undefined;
    } finally {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
  },
};
