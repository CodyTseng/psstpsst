import { platform } from '@/platform';
import type { FileAttachmentMeta } from '@/lib/nostr/file-tags';
import { fetchAndDecryptAttachment, getCachedAttachmentUri } from './file-attachment.service';

/** Explicit copy authorizes resolving this attachment, preserving integrity checks. */
export async function copyAttachment(
  meta: FileAttachmentMeta,
  options?: { accountPubkey?: string | null },
): Promise<void> {
  if (!platform.clipboard.canCopyAttachment(meta.mime)) throw new Error('Clipboard unavailable');
  const uri = (await getCachedAttachmentUri(meta)) ?? (await fetchAndDecryptAttachment(meta, options));
  await copyLocalAttachment({ uri, mime: meta.mime, name: meta.name });
}

export async function copyLocalAttachment(input: {
  uri: string; mime?: string; name?: string;
}): Promise<void> {
  await platform.clipboard.copyAttachment(input.uri, { mimeType: input.mime, name: input.name });
}

/** Copy a viewer image, resolving remote bytes only after the explicit action. */
export async function copyImageUri(uri: string): Promise<void> {
  let localUri = uri;
  if (/^https?:\/\//i.test(uri)) {
    localUri = (await platform.imageCache.getCachedUri(uri)) ?? (await platform.imageCache.download(uri));
  }
  // Single-image viewers can also contain renderer-owned bundled assets or
  // data/blob URLs. Native rendering stages these as a managed PNG on desktop.
  if (!localUri.startsWith('psstpsst-file://') && !localUri.startsWith('file://')) {
    const image = await platform.imageManipulator.renderAndSave(localUri, { format: 'png', quality: 1 });
    try {
      await copyLocalAttachment({ uri: image.uri, mime: 'image/png' });
    } finally {
      await platform.fileSystem.delete(image.uri, { idempotent: true }).catch(() => {});
    }
    return;
  }
  await copyLocalAttachment({ uri: localUri, mime: 'image/png' });
}
