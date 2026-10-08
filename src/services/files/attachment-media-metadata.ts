import { platform } from '@/platform';
import { computeThumbhash } from '@/lib/image/thumbhash';
import { validMediaDim, validMediaDimensions, type MediaDimensions } from '@/lib/attachments/media-dim';
import { getVideoMetadata } from './video-poster.service';

export type AttachmentMediaMetadata = { dim?: string; thumbhash?: string };

/** Prefer upload metadata; otherwise derive tags from the actual plaintext source. */
export async function readAttachmentMediaMetadata(
  uri: string,
  mime: string,
  encodedDimensions?: MediaDimensions,
  serverDim?: string,
  serverThumbhash?: string,
  localMetadata?: AttachmentMediaMetadata,
): Promise<AttachmentMediaMetadata> {
  const dim = validMediaDim(serverDim);
  const thumbhash = serverThumbhash || undefined;
  const supplied = { dim, thumbhash };
  if (dim && thumbhash) return supplied;
  if (localMetadata) {
    return { dim: dim ?? localMetadata.dim, thumbhash: thumbhash ?? localMetadata.thumbhash };
  }
  try {
    if (mime.startsWith('video/')) {
      const metadata = thumbhash
        ? await getVideoMetadata(uri, { includeThumbhash: false })
        : await getVideoMetadata(uri);
      return {
        dim: dim ?? (metadata && validMediaDimensions(metadata)
          ? `${metadata.width}x${metadata.height}` : undefined),
        thumbhash: thumbhash ?? metadata?.thumbhash,
      };
    }
    if (!mime.startsWith('image/')) return supplied;
    const parts = dim?.split('x');
    const dimensions = parts
      ? { width: Number(parts[0]), height: Number(parts[1]) }
      : encodedDimensions ?? await platform.imageManipulator.getDimensions(uri);
    if (!validMediaDimensions(dimensions)) return supplied;
    return {
      dim: dim ?? `${dimensions.width}x${dimensions.height}`,
      thumbhash: thumbhash ?? await computeThumbhash(uri, dimensions.width, dimensions.height)
        .catch(() => undefined),
    };
  } catch {
    // Unsupported or damaged media can still be sent as a file without visual metadata.
    return supplied;
  }
}
