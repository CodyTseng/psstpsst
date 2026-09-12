import { platform } from '@/platform';
import type { FileAttachmentMeta } from '@/lib/nostr/file-tags';
import type { EmbeddedMedia } from '@/lib/nostr/embedded-media';

import { mimeToExt } from './attachment-store';
import { fetchAndDecryptAttachment, getCachedAttachmentUri } from './file-attachment.service';

/** Outcome of a save-to-library attempt, so the UI can pick the right message. */
export type SaveResult = 'saved' | 'denied' | 'failed';

const MEDIA_SAVE_DIR_NAME = 'psstpsst-media-save';
let stagedCaptureSequence = 0;

async function mediaSaveDir(): Promise<string> {
  const base = await platform.fileSystem.cacheDirectoryUri();
  if (!base) throw new Error('FileSystem.cacheDirectory unavailable');
  const dir = `${base}${MEDIA_SAVE_DIR_NAME}/`;
  await platform.fileSystem.makeDirectory(dir, {
    intermediates: true,
    idempotent: true,
  });
  return dir;
}

async function stageDataUri(uri: string): Promise<string> {
  const response = await fetch(uri);
  if (!response.ok) throw new Error(`Unable to stage captured media (${response.status})`);
  const mime = uri.match(/^data:([^;,]+)/i)?.[1];
  stagedCaptureSequence += 1;
  const destination = `${await mediaSaveDir()}captured-${Date.now()}-${stagedCaptureSequence}${mimeToExt(mime) || '.bin'}`;
  await platform.fileSystem.writeBytes(
    destination,
    new Uint8Array(await response.arrayBuffer()),
  );
  return destination;
}

/**
 * Save a local file URI or a renderer-produced data URI to the device photo
 * library. Requests write-only permission first (the "Add Photos Only" grant is
 * all saving needs). Renderer data is staged only after permission succeeds;
 * stored files keep a real extension so the OS recognizes the media type.
 */
export async function saveUriToLibrary(uri: string): Promise<SaveResult> {
  let stagedUri: string | null = null;
  try {
    const granted = await platform.mediaLibrary.requestWritePermission();
    if (!granted) return 'denied';
    // react-native-view-shot returns a data URI on React Native Web. Electron's
    // native save dialog can only read files in managed app storage, so stage
    // renderer-owned bytes in the evictable cache before crossing the bridge.
    if (uri.startsWith('data:')) {
      stagedUri = await stageDataUri(uri);
    }
    await platform.mediaLibrary.saveToLibrary(stagedUri ?? uri);
    return 'saved';
  } catch {
    return 'failed';
  } finally {
    if (stagedUri) {
      try {
        await platform.fileSystem.delete(stagedUri, { idempotent: true });
      } catch {
        // The cache directory is OS-evictable; a failed cleanup is non-critical.
      }
    }
  }
}

/**
 * Resolve an attachment's local decrypted file — downloading + decrypting it
 * first if it isn't on disk yet (e.g. a video the user never played) — then save
 * it to the photo library.
 */
export async function saveAttachmentToLibrary(
  meta: FileAttachmentMeta,
  opts?: { accountPubkey?: string | null },
): Promise<SaveResult> {
  let uri: string;
  try {
    uri = (await getCachedAttachmentUri(meta)) ?? (await fetchAndDecryptAttachment(meta, opts));
  } catch {
    return 'failed';
  }
  return saveUriToLibrary(uri);
}

/** Explicitly save a direct URL to the system photo library. Ordinary media is
 * otherwise owned by expo-image / expo-video / expo-audio caches and never
 * promoted into PsstPsst's persistent attachment store. MediaLibrary requires a
 * local URI, so this action uses an OS-evictable temp file and removes it after
 * the library has imported the asset. */
export async function saveRemoteMediaToLibrary(media: EmbeddedMedia): Promise<SaveResult> {
  if (media.streaming) return 'failed';
  let downloadedUri: string | null = null;
  try {
    const dir = await mediaSaveDir();
    const ext = mimeToExt(media.mime);
    const name = `${media.sha256 ?? `remote-${Date.now()}`}${ext}`;
    const dest = `${dir}${name}`;
    await platform.fileSystem.downloadFile(media.url, dest, { idempotent: true });
    downloadedUri = dest;
    return await saveUriToLibrary(dest);
  } catch {
    return 'failed';
  } finally {
    try {
      if (downloadedUri) await platform.fileSystem.delete(downloadedUri);
    } catch {
      // The cache directory is OS-evictable; a failed cleanup is non-critical.
    }
  }
}
