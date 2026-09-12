import type { View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import type { SquareImageCaptureOptions } from './square-image-capture.types';

export function captureSquareImage(
  target: View,
  { outputSize }: SquareImageCaptureOptions,
): Promise<string> {
  return captureRef(target, {
    format: 'png',
    width: outputSize,
    height: outputSize,
    quality: 1,
    result: 'tmpfile',
  });
}
