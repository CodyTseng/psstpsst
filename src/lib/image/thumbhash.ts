import { base64 } from '@scure/base';
import { decode as decodeJpeg } from 'jpeg-js';
import { rgbaToThumbHash } from 'thumbhash';

import { platform } from '@/platform';

// ThumbHash is designed for thumbnails up to ~100px on the long side. We resize
// the source down to that natively (cheap), so the JS-side JPEG decode + encode
// work on a tiny image.
const MAX_DIM = 100;

/**
 * Compute a ThumbHash (base64) for a local image — a ~25-byte blurred preview
 * used as a loading placeholder (decoded natively by `expo-image`).
 *
 * Pipeline: native resize to ≤100px → JPEG → decode to RGBA in JS (`jpeg-js`,
 * `useTArray` to avoid needing a `Buffer` polyfill) → `rgbaToThumbHash`. The
 * native resize overlaps with the caller's encryption/upload, so it adds no
 * meaningful latency. **Best-effort**: returns `undefined` on any failure — a
 * missing placeholder just means the bubble loads without a blur, nothing more.
 */
export async function computeThumbhash(
  uri: string,
  width?: number,
  height?: number,
): Promise<string | undefined> {
  try {
    // Cap the *longer* side to MAX_DIM so neither dimension exceeds it (a tall
    // image capped on width could otherwise stay >100px tall). Orientation
    // unknown → assume landscape; ThumbHash tolerates a slightly larger input.
    const portrait = !!width && !!height && height > width;
    const out = await platform.imageManipulator.renderAndSave(uri, {
      resize: portrait ? { height: MAX_DIM } : { width: MAX_DIM },
      format: 'jpeg',
      quality: 0.7,
      includeBase64: true,
    });
    if (!out.base64) return undefined;

    const { width: w, height: h, data } = decodeJpeg(base64.decode(out.base64), {
      useTArray: true,
    });
    return base64.encode(rgbaToThumbHash(w, h, data));
  } catch {
    return undefined;
  }
}
