import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Image } from 'expo-image';

import type { ImageManipulatorPort } from '../ports/image-manipulator';

/** Image re-encoding backed by `expo-image-manipulator`. */
export const imageManipulatorAdapter: ImageManipulatorPort = {
  async getDimensions(uri) {
    const image = await Image.loadAsync(uri);
    try {
      return { width: image.width, height: image.height };
    } finally {
      image.release();
    }
  },
  async renderAndSave(uri, options) {
    const context = ImageManipulator.manipulate(uri);
    if (options.resize) context.resize(options.resize);
    const ref = await context.renderAsync();
    return ref.saveAsync({
      format:
        options.format === 'png'
          ? SaveFormat.PNG
          : options.format === 'webp'
            ? SaveFormat.WEBP
            : SaveFormat.JPEG,
      compress: options.quality,
      base64: options.includeBase64 ?? false,
    });
  },
};
