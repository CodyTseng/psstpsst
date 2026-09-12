import type { View } from 'react-native';

import type { SquareImageCaptureOptions } from './square-image-capture.types';

/** Render the framing directly, without cloning the preview into an iframe. */
export async function captureSquareImage(
  _target: View,
  options: SquareImageCaptureOptions,
): Promise<string> {
  const image = new window.Image();
  image.src = options.uri;
  // A failed decode must stop saving rather than produce a blank sticker.
  await image.decode();

  const canvas = document.createElement('canvas');
  canvas.width = options.outputSize;
  canvas.height = options.outputSize;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Custom emoji canvas is unavailable.');

  const ratio = options.outputSize / options.viewportSize;
  context.drawImage(
    image,
    ((options.viewportSize - options.imageWidth) / 2 + options.translationX) * ratio,
    ((options.viewportSize - options.imageHeight) / 2 + options.translationY) * ratio,
    options.imageWidth * ratio,
    options.imageHeight * ratio,
  );
  return canvas.toDataURL('image/png');
}
