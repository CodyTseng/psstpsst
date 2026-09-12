import { base64 } from '@scure/base';

import { platform } from '@/platform';
import { throwIfAborted } from '@/lib/async/abort';
import { resolveVoiceMime } from '@/lib/audio/voice';
import { computeThumbhash } from '@/lib/image/thumbhash';
import {
  DEFAULT_IMAGE_SEND_QUALITY,
  type ImageSendQuality,
} from '@/lib/attachments/image-quality';
import { buildFileTags, type FileAttachmentMeta } from '@/lib/nostr/file-tags';
import { blossomDownloadUrls, parseBlossomUri } from '@/lib/nostr/blossom-uri';

import type { Signer } from '../signer/signer.interface';
import {
  listConversationUrls,
  listOrphanBlobsForAccount,
  listOrphanBlobsForConversation,
  markDownloaded,
  removeStoredFilesByOx,
  resolveDownloaded,
} from './attachment-index.service';
import {
  attachmentName,
  attachmentPath,
  ensureAttachmentDir,
  extFromName,
  mimeToExt,
  resolveAttachmentPath,
  sniffMime,
} from './attachment-store';
import { downloadBlob, downloadBlobWithFallback, uploadEncryptedBlob } from './blossom.service';
import { decryptBytes, encryptBytes, sha256Hex } from './file-crypto';
import { loadAccountMediaServers } from './media-server.service';
import { stageNearbyUpload } from './nearby-file-upload.service';
import { prepareAttachmentImage } from './strip-metadata';
import { fetchNearbyNetworkFirst } from './nearby-file-source-order';
import {
  fetchNearbyAttachmentFromBlossom,
  NearbyRemoteIntegrityError,
} from './nearby-file-download.service';
import { proximityService } from '../proximity/proximity.service';
import {
  ProximityFileTransferError,
} from '../proximity/proximity-file-transfer.service';
import { parseNearbyFileOffer } from '../proximity/proximity-file-offer';
import { ProximityFileCancelReason } from '../proximity/proximity-protocol';
import {
  attachmentTransferKey,
  attachmentTransferStore,
} from './attachment-transfer-state';

/**
 * Orchestrates the local decrypted-attachment store: encrypt+upload on send,
 * download+decrypt+cache on view. The on-disk pool is content-addressed by the
 * **plaintext** sha256 (`{plainHash}{ext}`, see {@link attachmentName}) so the
 * same file shared across conversations is stored exactly once; the
 * `attachment_urls`, `stored_files`, and `message_media` indexes are the
 * bookkeeping layers for resolving, deduplicating, and deleting those files.
 */

/**
 * Why an attachment fetch failed, so the bubble can react differently:
 * - `download`  — the blob couldn't be fetched or decrypted (network, dead
 *   server, wrong key). Transient/operational → the UI offers a plain retry.
 * - `integrity` — the bytes arrived but their `x`/`ox` content hash didn't
 *   match what the message claimed: corruption, or tampering on the (untrusted)
 *   media server. A security signal → the UI warns and only proceeds on an
 *   explicit confirm (which re-fetches with `allowIntegrityMismatch`).
 */
export type AttachmentErrorKind = 'download' | 'integrity';

export type NearbyAttachmentFetchContext = {
  peerPubkey: string;
  rumorId: string;
  tags: string[][];
};

export class AttachmentError extends Error {
  readonly kind: AttachmentErrorKind;
  constructor(kind: AttachmentErrorKind, message: string) {
    super(message);
    this.name = 'AttachmentError';
    this.kind = kind;
  }
}

/** Classify a caught error for the bubble; anything not from us is operational. */
export function attachmentErrorKind(err: unknown): AttachmentErrorKind {
  return err instanceof AttachmentError ? err.kind : 'download';
}

/**
 * Synchronous lookup of decrypted files seen this session, keyed by the blob's
 * message **URL** (always present, no `x`/Blossom assumption). Lets a freshly
 * sent/received bubble render on the first frame instead of flashing a spinner
 * while the async disk check resolves.
 */
const sessionCache = new Map<string, string>();

// Raw byte I/O via the port's byte reader/writer — read/write the bytes natively
// instead of round-tripping a multi-MB file through a base64 string on the JS
// thread. That base64 encode/decode was a big, avoidable chunk of the send-time
// UI freeze; only the AES-GCM itself now blocks the JS thread.
async function readLocalFileBytes(uri: string): Promise<Uint8Array> {
  // The byte reader only handles real filesystem paths. Some Android pickers
  // hand back a `content://` uri, which only the base64 reader can resolve —
  // fall back to it there.
  if (uri.startsWith('file://') || uri.startsWith('/')) {
    return platform.fileSystem.readBytes(uri);
  }
  const b64 = await platform.fileSystem.readBase64(uri);
  return base64.decode(b64);
}

function writeFileBytes(targetUri: string, bytes: Uint8Array): Promise<void> {
  return platform.fileSystem.writeBytes(targetUri, bytes);
}

/** Content-addressed write: skip it when an identical-content file already
 * exists (dedup) — the same blob shared across chats is stored once. */
async function writeDedup(targetUri: string, bytes: Uint8Array): Promise<void> {
  const info = await platform.fileSystem.stat(targetUri);
  if (!info.exists) await writeFileBytes(targetUri, bytes);
}

function nameForEncodedMime(name: string | undefined, mime: string): string | undefined {
  if (!name) return undefined;
  const extension = mimeToExt(mime);
  if (!extension) return name;
  return name.replace(/\.[a-z0-9]{1,8}$/i, '') + extension;
}

export type UploadAttachmentOpts = {
  signer: Signer;
  /** Local file URI (e.g., from expo-image-picker). */
  localUri: string;
  mime?: string;
  /** Original filename (documents) — carried in the private `name` tag. */
  name?: string;
  /** "WxH" — populates imeta dim. */
  dim?: string;
  /** Voice messages: clip length in seconds (`duration` tag). */
  durationSec?: number;
  /** Voice messages: amplitude bars 0–100 (`waveform` tag). */
  waveform?: number[];
  /** Per-send image quality. Non-image attachments ignore this field. */
  imageQuality?: ImageSendQuality;
  /** Account's configured Blossom servers (kind 10063), tried in order. Falls
   * back to the built-in defaults when omitted. */
  servers?: string[];
  /** Invoked as the pipeline transitions; lets the UI update overlays. */
  onStep?: (step: 'encrypting' | 'uploading') => void;
  onUploadProgress?: (sentBytes: number, totalBytes: number) => void;
  signal?: AbortSignal;
};

export type UploadAttachmentResult = {
  meta: FileAttachmentMeta;
  /** NIP-17 file-message tags ready to spread into the rumor. */
  tags: string[][];
  /** Blossom URL (also embedded in `tags`). */
  url: string;
  /** Plaintext byte length stored under `meta.plainSha256Hex`. */
  localSize: number;
  /** Whether the best-effort local plaintext mirror was written successfully. */
  storedLocally: boolean;
  /** Permanent plaintext mirror URI, available immediately to the sender UI. */
  localUri?: string;
};

export type StageNearbyAttachmentOpts = Omit<UploadAttachmentOpts, 'signer'> & {
  accountPubkey: string;
  servers: string[];
};

async function ensureUploadDir(): Promise<string> {
  const dir = `${await platform.fileSystem.cacheDirectoryUri()}psstpsst-uploads/`;
  const info = await platform.fileSystem.stat(dir);
  if (!info.exists) {
    await platform.fileSystem.makeDirectory(dir, { intermediates: true });
  }
  return dir;
}

/**
 * Read local file → AES-GCM encrypt → write ciphertext to temp → upload to
 * Blossom → return the imeta tag + URL ready to be embedded in a kind-15
 * rumor.
 */
export async function uploadAttachment(
  opts: UploadAttachmentOpts,
): Promise<UploadAttachmentResult> {
  throwIfAborted(opts.signal);
  // Strip EXIF / GPS (and all other metadata) from images by re-encoding before
  // we read the bytes — so neither the uploaded blob nor our local mirror leaks
  // the capture location. Best-effort: on any failure we fall back to the
  // original. Videos can't be stripped without a transcode, so they pass through.
  let sourceUri = opts.localUri;
  let dim = opts.dim;
  let strippedUri: string | null = null;
  try {
    const requestedDim = opts.dim?.match(/^(\d+)x(\d+)$/);
    const stripped = await prepareAttachmentImage(
      opts.localUri,
      opts.mime,
      opts.imageQuality ?? DEFAULT_IMAGE_SEND_QUALITY,
      requestedDim
        ? { width: Number(requestedDim[1]), height: Number(requestedDim[2]) }
        : undefined,
    );
    if (stripped) {
      sourceUri = stripped.uri;
      strippedUri = stripped.uri;
      dim = `${stripped.width}x${stripped.height}`;
    }
  } catch {
    // keep the original file
  }
  throwIfAborted(opts.signal);

  // Compute the ThumbHash placeholder for images in parallel — the native
  // resize overlaps the encryption + upload below, so it adds no real latency.
  const dimMatch = dim?.match(/^(\d+)x(\d+)$/);
  const thumbhashPromise = opts.mime?.startsWith('image/')
    ? computeThumbhash(
        sourceUri,
        dimMatch ? Number(dimMatch[1]) : undefined,
        dimMatch ? Number(dimMatch[2]) : undefined,
      )
    : opts.mime?.startsWith('video/')
      ? platform.videoThumbnail.generateThumbhash(sourceUri)
      : Promise.resolve<string | undefined>(undefined);

  const plain = await readLocalFileBytes(sourceUri);
  throwIfAborted(opts.signal);
  opts.onStep?.('encrypting');
  // AES-GCM now runs off the JS thread (expo-crypto, async), so the optimistic
  // "encrypting" bubble paints on its own — no manual macrotask yield needed.
  const { cipher, cipherSha256Hex, plainSha256Hex, keyHex, nonceHex } =
    await encryptBytes(plain);
  throwIfAborted(opts.signal);

  // The real type, most-trusted first: sniff the bytes, then a specific picker
  // mime, else encode the original suffix as `application/<ext>` so receivers can
  // still name the file (`report.sketch` → `application/sketch`), else opaque.
  const origExt = extFromName(opts.name);
  const detectedMime =
    sniffMime(plain) ??
    (opts.mime && opts.mime !== 'application/octet-stream' ? opts.mime : null) ??
    (origExt ? `application/${origExt}` : 'application/octet-stream');
  const isVoice = opts.durationSec !== undefined || opts.waveform !== undefined;
  // MP4/WebM signatures only identify their container. A voice recording has
  // no video track, so its explicit voice metadata is the authoritative signal
  // for the media category.
  const mime = isVoice ? resolveVoiceMime(opts.mime, detectedMime) : detectedMime;

  const uploadDir = await ensureUploadDir();
  const cipherUri = `${uploadDir}${cipherSha256Hex}.bin`;
  await writeFileBytes(cipherUri, cipher);
  throwIfAborted(opts.signal);
  opts.onStep?.('uploading');
  try {
    const uploaded = await uploadEncryptedBlob({
      signer: opts.signer,
      cipherFileUri: cipherUri,
      cipherSha256Hex,
      sizeBytes: cipher.byteLength,
      servers: opts.servers,
      signal: opts.signal,
      onProgress: opts.onUploadProgress,
    });
    throwIfAborted(opts.signal);
    const thumbhash = await thumbhashPromise;
    throwIfAborted(opts.signal);
    const meta: FileAttachmentMeta = {
      url: uploaded.url,
      mime,
      name: nameForEncodedMime(opts.name, mime),
      cipherSha256Hex,
      plainSha256Hex,
      size: cipher.byteLength,
      plainSize: plain.byteLength,
      dim,
      thumbhash,
      durationSec: opts.durationSec,
      waveform: opts.waveform,
      decryptionKeyHex: keyHex,
      decryptionNonceHex: nonceHex,
    };

    // Mirror the plaintext into the local store under its content key, so the
    // sender's bubble renders instantly and stays openable offline forever (no
    // re-download/decrypt on later views). Keyed by plaintext hash → dedup.
    await ensureAttachmentDir();
    let storedLocally = false;
    let localUri: string | undefined;
    try {
      const mirror = await attachmentPath(attachmentName(plainSha256Hex, mime));
      await writeDedup(mirror, plain);
      throwIfAborted(opts.signal);
      sessionCache.set(uploaded.url, mirror);
      storedLocally = true;
      localUri = mirror;
    } catch {
      // Cache write is best-effort; failing here only means we'd re-fetch.
    }

    return {
      meta,
      tags: buildFileTags(meta),
      url: uploaded.url,
      localSize: plain.byteLength,
      storedLocally,
      localUri,
    };
  } finally {
    await platform.fileSystem.delete(cipherUri, { idempotent: true }).catch(() => {});
    // The metadata-stripped re-encode is a throwaway cache file; its bytes are
    // already encrypted + mirrored under the content hash.
    if (strippedUri) {
      await platform.fileSystem.delete(strippedUri, { idempotent: true }).catch(() => {});
    }
  }
}

/** Encrypt and durably stage a Nearby attachment before its kind-15 rumor is authored. */
export async function stageNearbyAttachment(
  opts: StageNearbyAttachmentOpts,
): Promise<UploadAttachmentResult> {
  throwIfAborted(opts.signal);
  let sourceUri = opts.localUri;
  let dim = opts.dim;
  let strippedUri: string | null = null;
  try {
    const requestedDim = opts.dim?.match(/^(\d+)x(\d+)$/);
    const stripped = await prepareAttachmentImage(
      opts.localUri,
      opts.mime,
      opts.imageQuality ?? DEFAULT_IMAGE_SEND_QUALITY,
      requestedDim
        ? { width: Number(requestedDim[1]), height: Number(requestedDim[2]) }
        : undefined,
    ).catch(() => null);
    if (stripped) {
      sourceUri = stripped.uri;
      strippedUri = stripped.uri;
      dim = `${stripped.width}x${stripped.height}`;
    }
    const dimMatch = dim?.match(/^(\d+)x(\d+)$/);
    const thumbhashPromise = opts.mime?.startsWith('image/')
      ? computeThumbhash(
          sourceUri,
          dimMatch ? Number(dimMatch[1]) : undefined,
          dimMatch ? Number(dimMatch[2]) : undefined,
        )
      : opts.mime?.startsWith('video/')
        ? platform.videoThumbnail.generateThumbhash(sourceUri)
        : Promise.resolve<string | undefined>(undefined);
    const plain = await readLocalFileBytes(sourceUri);
    throwIfAborted(opts.signal);
    opts.onStep?.('encrypting');
    const { cipher, cipherSha256Hex, plainSha256Hex, keyHex, nonceHex } =
      await encryptBytes(plain);
    throwIfAborted(opts.signal);
    const origExt = extFromName(opts.name);
    const detectedMime =
      sniffMime(plain) ??
      (opts.mime && opts.mime !== 'application/octet-stream' ? opts.mime : null) ??
      (origExt ? `application/${origExt}` : 'application/octet-stream');
    const isVoice = opts.durationSec !== undefined || opts.waveform !== undefined;
    const mime = isVoice ? resolveVoiceMime(opts.mime, detectedMime) : detectedMime;
    const thumbhash = await thumbhashPromise;
    throwIfAborted(opts.signal);

    await ensureAttachmentDir();
    const mirror = await attachmentPath(attachmentName(plainSha256Hex, mime));
    await writeDedup(mirror, plain);
    const staged = await stageNearbyUpload({
      accountPubkey: opts.accountPubkey,
      x: cipherSha256Hex,
      ox: plainSha256Hex,
      cipher,
      plainSize: plain.length,
      keyHex,
      nonceHex,
      mime,
      servers: opts.servers,
    });
    const meta: FileAttachmentMeta = {
      url: staged.url,
      mime,
      name: nameForEncodedMime(opts.name, mime),
      cipherSha256Hex,
      plainSha256Hex,
      size: cipher.length,
      plainSize: plain.length,
      dim,
      thumbhash,
      durationSec: opts.durationSec,
      waveform: opts.waveform,
      decryptionKeyHex: keyHex,
      decryptionNonceHex: nonceHex,
    };
    await markDownloaded(staged.url, plainSha256Hex, mime, plain.length);
    sessionCache.set(staged.url, mirror);
    return {
      meta,
      tags: buildFileTags(meta),
      url: staged.url,
      localSize: plain.length,
      storedLocally: true,
      localUri: mirror,
    };
  } finally {
    if (strippedUri) {
      await platform.fileSystem.delete(strippedUri, { idempotent: true }).catch(() => {});
    }
  }
}

/** Resolve a downloaded blob's on-disk path from its meta, via the index
 * (`ox` + real `mime` → `{ox}{ext}`). Null when the content isn't on disk yet. */
async function resolvePath(meta: FileAttachmentMeta): Promise<string | null> {
  const ref = await resolveDownloaded(meta);
  if (!ref) return null;
  return resolveAttachmentPath(attachmentName(ref.ox, ref.mime));
}

/**
 * If we've already decrypted this blob, return the cached file URI. Otherwise
 * download → (verify `x`) → decrypt → (verify `ox`) → content-address by the
 * plaintext hash → cache, then return the URI. The `x`/`ox` integrity checks
 * run only when those tags are present (other clients may omit them).
 *
 * Throws an {@link AttachmentError} on failure — `kind: 'download'` for a fetch/
 * decrypt failure (caller offers retry), `kind: 'integrity'` for an `x`/`ox`
 * hash mismatch (caller warns + confirms). Pass `allowIntegrityMismatch` to
 * proceed past a known mismatch once the user has accepted the risk.
 */
export async function fetchAndDecryptAttachment(
  meta: FileAttachmentMeta,
  opts?: {
    accountPubkey?: string | null;
    allowIntegrityMismatch?: boolean;
    signal?: AbortSignal;
    nearby?: NearbyAttachmentFetchContext;
  },
): Promise<string> {
  await ensureAttachmentDir();

  // Fast path: already downloaded + on disk (resolved by ox, or by url).
  const cached = await resolvePath(meta);
  if (cached) {
    sessionCache.set(meta.url, cached);
    return cached;
  }

  const nearbyOffer = opts?.nearby
    ? parseNearbyFileOffer(meta.url, opts.nearby.tags)
    : null;
  if (nearbyOffer && opts?.accountPubkey && opts.nearby) {
    const accountPubkey = opts.accountPubkey;
    const nearby = opts.nearby;
    const progressKey = attachmentTransferKey(accountPubkey, nearby.rumorId);
    try {
      throwIfAborted(opts.signal);
      const result = await fetchNearbyNetworkFirst({
        signal: opts.signal,
        network: async () => {
          attachmentTransferStore.getState().update(progressKey, 'network', 0, nearbyOffer.size);
          return fetchNearbyAttachmentFromBlossom({
            accountPubkey,
            peerPubkey: nearby.peerPubkey,
            rumorId: nearby.rumorId,
            offer: nearbyOffer,
            signal: opts.signal,
            onProgress: (receivedBytes, totalBytes) =>
              attachmentTransferStore
                .getState()
                .update(progressKey, 'network', receivedBytes, totalBytes),
          });
        },
        bluetooth: async () => {
          attachmentTransferStore
            .getState()
            .update(progressKey, 'bluetooth', 0, nearbyOffer.plainSize);
          return proximityService.fetchAttachmentDirect({
            accountPubkey,
            peerPubkey: nearby.peerPubkey,
            rumorId: nearby.rumorId,
            signal: opts.signal,
            onProgress: (receivedBytes, totalBytes) =>
              attachmentTransferStore
                .getState()
                .update(progressKey, 'bluetooth', receivedBytes, totalBytes),
          });
        },
      });
      if (result.ok) {
        sessionCache.set(meta.url, result.value);
        return result.value;
      }
      if (
        result.bluetoothError instanceof ProximityFileTransferError &&
        !result.bluetoothError.retryable &&
        result.bluetoothError.reason === ProximityFileCancelReason.IntegrityFailure
      ) {
        throw new AttachmentError('integrity', result.bluetoothError.message);
      }
      if (result.networkError instanceof NearbyRemoteIntegrityError) {
        throw new AttachmentError('integrity', result.networkError.message);
      }
      if (
        result.bluetoothError instanceof ProximityFileTransferError &&
        !result.bluetoothError.retryable
      ) {
        throw new AttachmentError('download', result.bluetoothError.message);
      }
      const errors = [result.networkError, result.bluetoothError]
        .map((error) => (error instanceof Error ? error.message : String(error)))
        .filter(Boolean);
      throw new AttachmentError('download', errors.join('\n') || 'Attachment is unavailable');
    } finally {
      attachmentTransferStore.getState().clear(progressKey);
    }
  }

  // With an account, fall back across its configured media servers (kind 10063)
  // if the embedded URL is dead/rotated — the blob is mirrored there (BUD-04).
  // A fetch failure is operational (network/dead server) → `download` kind.
  let cipher: Uint8Array;
  try {
    const blossom = parseBlossomUri(meta.url);
    if (blossom) {
      const errors: string[] = [];
      let downloaded: Uint8Array | null = null;
      for (const url of blossomDownloadUrls(blossom)) {
        try {
          downloaded = await downloadBlob(url);
          break;
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
      if (!downloaded) throw new Error(errors.join('\n') || 'No media server is available');
      cipher = downloaded;
    } else {
      cipher = opts?.accountPubkey
        ? await downloadBlobWithFallback({
            url: meta.url,
            servers: await loadAccountMediaServers(opts.accountPubkey),
          })
        : await downloadBlob(meta.url);
    }
  } catch (err) {
    throw new AttachmentError('download', (err as Error).message);
  }

  // Whether either content hash failed to match. When the user has accepted the
  // risk (`allowIntegrityMismatch`) we still decrypt + show the bytes, but we
  // never persist them as the canonical blob in the index (see below).
  let mismatched = false;

  // Ciphertext integrity: `meta.cipherSha256Hex` is a real content address when
  // it's a 64-hex (from the `x` tag, or the hash embedded in a Blossom URL); a
  // non-hex value (a plain URL slug) carries no hash to check against.
  if (/^[0-9a-f]{64}$/i.test(meta.cipherSha256Hex)) {
    const cipherHash = await sha256Hex(cipher);
    if (cipherHash !== meta.cipherSha256Hex.toLowerCase()) {
      if (!opts?.allowIntegrityMismatch) {
        throw new AttachmentError('integrity', 'ciphertext hash mismatch');
      }
      mismatched = true;
    }
  }

  // AES-GCM decrypt runs off the JS thread (expo-crypto, async), so loading an
  // image no longer janks the message list while scrolling. A decrypt failure
  // (wrong key / unreadable bytes) leaves nothing to reveal → `download` kind.
  let plain: Uint8Array;
  try {
    plain = await decryptBytes({
      cipher,
      keyHex: meta.decryptionKeyHex,
      nonceHex: meta.decryptionNonceHex,
    });
  } catch (err) {
    throw new AttachmentError('download', (err as Error).message);
  }

  // Plaintext hash names the file (content address → dedup) and, when the sender
  // gave an `ox`, verifies it (guards corruption + a spoofed `ox`).
  const plainHash = await sha256Hex(plain);
  if (meta.plainSha256Hex && meta.plainSha256Hex.toLowerCase() !== plainHash) {
    if (!opts?.allowIntegrityMismatch) {
      throw new AttachmentError('integrity', 'plaintext hash mismatch');
    }
    mismatched = true;
  }

  // Real type from the decrypted bytes; fall back to the sender's `file-type`
  // tag (may be our `application/<ext>` form), then opaque. Its extension names
  // the on-disk file.
  const detectedMime = sniffMime(plain) ?? meta.mime ?? 'application/octet-stream';
  const isDeclaredVoice =
    (meta.durationSec !== undefined || meta.waveform !== undefined) &&
    meta.mime?.trim().toLowerCase().startsWith('audio/');
  // Preserve the immutable event's declared media category. Only an event that
  // already declares an audio voice note may override an ambiguous MP4/WebM
  // container sniff; legacy `video/*` declarations remain video.
  const mime = isDeclaredVoice ? resolveVoiceMime(meta.mime, undefined) : detectedMime;
  const target = await attachmentPath(attachmentName(plainHash, mime));
  await writeDedup(target, plain);
  sessionCache.set(meta.url, target);
  // Mark this content downloaded for every message that references it (so a
  // sibling message resolves it without re-downloading) — but NOT when the user
  // bypassed a hash mismatch: a tampered/corrupt blob must never be recorded as
  // the canonical attachment, so it re-checks (and re-warns) on the next view.
  if (!mismatched) await markDownloaded(meta.url, plainHash, mime, plain.byteLength);
  return target;
}

/** Quickly check the local store without network. */
export async function getCachedAttachmentUri(
  meta: FileAttachmentMeta,
): Promise<string | null> {
  const path = await resolvePath(meta);
  if (path) sessionCache.set(meta.url, path);
  return path;
}

/** Synchronous, session-only cache hit — no filesystem call. */
export function getSessionCachedUri(meta: FileAttachmentMeta): string | null {
  return sessionCache.get(meta.url) ?? null;
}

/**
 * Copy a (content-hash-named) stored file to a temp file under its **original
 * filename**, so the OS share sheet hands the target app a sensibly-named file
 * (`report.sketch`, not `a3f2….sketch`). Lives in the evictable cache. Returns
 * the original uri unchanged on any failure or when there's no name.
 */
export async function copyForShare(uri: string, name?: string): Promise<string> {
  if (!name) return uri;
  try {
    const safe = name.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'file';
    const dir = `${await platform.fileSystem.cacheDirectoryUri()}psstpsst-share/`;
    await platform.fileSystem.makeDirectory(dir, { intermediates: true }).catch(() => {});
    const dest = `${dir}${safe}`;
    await platform.fileSystem.delete(dest, { idempotent: true }).catch(() => {});
    await platform.fileSystem.copy(uri, dest);
    return dest;
  } catch {
    return uri;
  }
}

/**
 * Free the physical files a conversation references — but only those **no other
 * live conversation** still points at (reference counting by `ox` via the
 * media and URL mappings are kept (the messages survive a soft delete), while
 * each freed file's local-state row is removed so a resurrected conversation
 * re-downloads it on demand. Best-effort; safe to fire-and-forget.
 */
export async function deleteConversationAttachments(
  accountPubkey: string,
  conversationKey: string,
): Promise<void> {
  const [orphans, urls] = await Promise.all([
    listOrphanBlobsForConversation(accountPubkey, conversationKey),
    listConversationUrls(accountPubkey, conversationKey),
  ]);
  for (const url of urls) sessionCache.delete(url);
  await Promise.all(
    orphans.map(async (b) =>
      platform.fileSystem
        .delete(await attachmentPath(attachmentName(b.ox, b.mime)), { idempotent: true })
        .catch(() => {}),
    ),
  );
  await removeStoredFilesByOx(orphans.map((b) => b.ox));
}

/**
 * Physically delete the on-disk blobs an account owns that no **other** account
 * still references — used when the account is removed. Reference-counted by `ox`
 * (a blob shared with a remaining account stays). Must run **before** the
 * account's `message_media` rows are deleted (the count reads them). Best-effort.
 */
export async function deleteAccountAttachments(accountPubkey: string): Promise<void> {
  const orphans = await listOrphanBlobsForAccount(accountPubkey);
  await Promise.all(
    orphans.map(async (b) =>
      platform.fileSystem
        .delete(await attachmentPath(attachmentName(b.ox, b.mime)), { idempotent: true })
        .catch(() => {}),
    ),
  );
  await removeStoredFilesByOx(orphans.map((blob) => blob.ox));
}
