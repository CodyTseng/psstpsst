import { platform } from '@/platform';
import type { ImageSendQuality } from '@/lib/attachments/image-quality';

export type StrippedImage = { uri: string; width: number; height: number };

/**
 * Re-encode an image so the result carries **no EXIF / GPS** (or any other
 * embedded metadata) — photos from a camera routinely embed the capture
 * location, which we must not leak when sharing. Rendering then re-saving the
 * bitmap drops every metadata block; baking in the EXIF orientation along the
 * way also removes the orientation tag (the pixels are already upright).
 *
 * Returns a fresh cache uri (the caller deletes it after reading) plus the
 * encoded dimensions, or `null` when the file isn't a re-encodable image — for
 * those (incl. animated GIFs, whose frames a re-encode would flatten, and all
 * non-image files) the caller keeps the original.
 *
 * Note: this covers images only. Stripping location atoms from a video would
 * require a full transcode (no lightweight Expo API), so videos are uploaded
 * as-is for now.
 */
export async function stripImageMetadata(
  uri: string,
  mime?: string,
  quality = 0.92,
): Promise<StrippedImage | null> {
  if (!mime?.startsWith('image/') || mime === 'image/gif') return null;
  // Keep PNG as PNG (preserve alpha, lossless); everything else → JPEG.
  const format = mime === 'image/png' ? 'png' : 'jpeg';
  // No transforms — just a clean re-encode. `quality` is ignored for PNG.
  const out = await platform.imageManipulator.renderAndSave(uri, { format, quality });
  return { uri: out.uri, width: out.width, height: out.height };
}

const OPTIMIZED_TARGET_BYTES = 512 * 1024;
const OPTIMIZED_MAX_EDGE = 1600;
const OPTIMIZED_FALLBACK_EDGE = 1280;
const MINIMUM_SAVINGS_RATIO = 0.15;
const COMPRESSIBLE_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/bmp',
  'image/tiff',
]);
const PNG_ANIMATION_SCAN_BYTES = 256 * 1024;

async function isAnimatedPng(uri: string): Promise<boolean> {
  const handle = await platform.fileSystem.openReadHandle(uri);
  try {
    const bytes = await handle.readBytes(
      Math.min(handle.size ?? PNG_ANIMATION_SCAN_BYTES, PNG_ANIMATION_SCAN_BYTES),
    );
    for (let index = 0; index <= bytes.length - 4; index += 1) {
      if (
        bytes[index] === 0x61 &&
        bytes[index + 1] === 0x63 &&
        bytes[index + 2] === 0x54 &&
        bytes[index + 3] === 0x4c
      ) {
        return true;
      }
    }
    return false;
  } finally {
    await handle.close();
  }
}

function resizeForEdge(
  width: number,
  height: number,
  maximumEdge: number,
): { width?: number; height?: number } | undefined {
  if (Math.max(width, height) <= maximumEdge) return undefined;
  return width >= height ? { width: maximumEdge } : { height: maximumEdge };
}

/** Prepare a private-message image according to the user's per-send quality choice. */
export async function prepareAttachmentImage(
  uri: string,
  mime: string | undefined,
  quality: ImageSendQuality,
  dimensions?: { width?: number; height?: number },
): Promise<StrippedImage | null> {
  if (
    !mime?.startsWith('image/') ||
    mime === 'image/gif' ||
    mime === 'image/svg+xml' ||
    mime === 'image/webp' ||
    mime === 'image/avif'
  ) {
    return null;
  }
  if (mime === 'image/png' && (await isAnimatedPng(uri).catch(() => false))) return null;
  if (quality === 'original' || !COMPRESSIBLE_IMAGE_TYPES.has(mime)) {
    return stripImageMetadata(uri, mime, quality === 'original' ? 1 : 0.92);
  }

  const sanitized = await stripImageMetadata(uri, mime);
  if (!sanitized) return null;
  const sanitizedStat = await platform.fileSystem.stat(sanitized.uri);
  const sanitizedSize = sanitizedStat.size ?? Number.MAX_SAFE_INTEGER;
  if (
    sanitizedSize <= OPTIMIZED_TARGET_BYTES &&
    Math.max(sanitized.width, sanitized.height) <= OPTIMIZED_MAX_EDGE
  ) {
    return sanitized;
  }

  const width = dimensions?.width ?? sanitized.width;
  const height = dimensions?.height ?? sanitized.height;
  const candidates = [
    { edge: OPTIMIZED_MAX_EDGE, quality: 0.82 },
    { edge: OPTIMIZED_MAX_EDGE, quality: 0.72 },
    { edge: OPTIMIZED_FALLBACK_EDGE, quality: 0.72 },
    { edge: OPTIMIZED_FALLBACK_EDGE, quality: 0.62 },
  ] as const;
  let best: (StrippedImage & { size: number }) | null = null;
  try {
    for (const candidate of candidates) {
      const rendered = await platform.imageManipulator.renderAndSave(uri, {
        resize: resizeForEdge(width, height, candidate.edge),
        format: 'webp',
        quality: candidate.quality,
      });
      const size = (await platform.fileSystem.stat(rendered.uri)).size ?? Number.MAX_SAFE_INTEGER;
      if (!best || size < best.size) {
        if (best) {
          await platform.fileSystem.delete(best.uri, { idempotent: true }).catch(() => {});
        }
        best = { uri: rendered.uri, width: rendered.width, height: rendered.height, size };
      } else {
        await platform.fileSystem.delete(rendered.uri, { idempotent: true }).catch(() => {});
      }
      if (size <= OPTIMIZED_TARGET_BYTES) break;
    }
  } catch (error) {
    if (best) await platform.fileSystem.delete(best.uri, { idempotent: true }).catch(() => {});
    await platform.fileSystem.delete(sanitized.uri, { idempotent: true }).catch(() => {});
    throw error;
  }

  if (!best || best.size > sanitizedSize * (1 - MINIMUM_SAVINGS_RATIO)) {
    if (best) await platform.fileSystem.delete(best.uri, { idempotent: true }).catch(() => {});
    return sanitized;
  }
  await platform.fileSystem.delete(sanitized.uri, { idempotent: true }).catch(() => {});
  return best;
}
