import { parseBlossomUri } from './blossom-uri';

/**
 * NIP-17 kind-15 file-message encoding.
 *
 * Per the spec, the file URL lives in the event's `content` field (NOT a tag),
 * and the metadata tags use kebab-case keys:
 *   file-type, encryption-algorithm, decryption-key, decryption-nonce,
 *   x (ciphertext sha256), ox (plaintext sha256), size, dim, blurhash, …
 *
 * Voice messages reuse this same kind-15 shape (mime `audio/*`) and add two flat
 * tags borrowed from the public voice-note (kind-1222) convention: `duration`
 * (whole seconds) and `waveform` (space-separated 0–100 amplitude bars). They
 * ride inside the encrypted gift wrap like every other tag, so they stay private.
 */

/** Amplitude bars are clamped to this integer range (the kind-1222 convention). */
const WAVEFORM_MAX = 100;

export type FileAttachmentMeta = {
  /** From the event `content`. */
  url: string;
  mime?: string;
  /** Original filename (for the file-card bubble), carried in a private `name`
   * tag — kind-15 tags live inside the encrypted gift wrap, so it isn't exposed. */
  name?: string;
  /** sha256 of the ciphertext bytes (`x` tag, Blossom blob address). */
  cipherSha256Hex: string;
  /** sha256 of the plaintext bytes (`ox` tag). */
  plainSha256Hex?: string;
  /** Size of the encrypted file in bytes. */
  size?: number;
  /** Size of the plaintext file in bytes. */
  plainSize?: number;
  /** "<width>x<height>". */
  dim?: string;
  blurhash?: string;
  /** ThumbHash (base64) — a tiny blurred image/video poster shown while the
   * attachment bytes remain remote. Decoded natively by `expo-image`. */
  thumbhash?: string;
  /** Voice messages: clip length in whole seconds (`duration` tag). Lets the
   * bubble show the length before the audio is fetched. */
  durationSec?: number;
  /** Voice messages: amplitude bars, integers 0–100 (`waveform` tag). Drives the
   * waveform drawn in the audio bubble. */
  waveform?: number[];
  decryptionKeyHex: string;
  decryptionNonceHex: string;
};

const ALGO = 'aes-gcm';

/** Tags for a kind-15 rumor. The URL is carried in `content`, not here. */
export function buildFileTags(m: FileAttachmentMeta): string[][] {
  const tags: string[][] = [
    ['file-type', m.mime ?? 'application/octet-stream'],
    ['encryption-algorithm', ALGO],
    ['decryption-key', m.decryptionKeyHex],
    ['decryption-nonce', m.decryptionNonceHex],
    ['x', m.cipherSha256Hex],
  ];
  if (m.plainSha256Hex) tags.push(['ox', m.plainSha256Hex]);
  if (typeof m.size === 'number') tags.push(['size', String(m.size)]);
  if (typeof m.plainSize === 'number') tags.push(['plain-size', String(m.plainSize)]);
  if (m.dim) tags.push(['dim', m.dim]);
  if (m.blurhash) tags.push(['blurhash', m.blurhash]);
  if (m.thumbhash) tags.push(['thumbhash', m.thumbhash]);
  if (m.name) tags.push(['name', m.name]);
  if (typeof m.durationSec === 'number' && Number.isFinite(m.durationSec)) {
    tags.push(['duration', String(Math.max(0, Math.round(m.durationSec)))]);
  }
  if (m.waveform && m.waveform.length > 0) {
    tags.push(['waveform', m.waveform.join(' ')]);
  }
  return tags;
}

/** Parse a `waveform` tag value ("0 7 35 …") into clamped 0–100 integers. */
function parseWaveform(value?: string): number[] | undefined {
  if (!value) return undefined;
  const bars = value
    .trim()
    .split(/\s+/)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.max(0, Math.min(WAVEFORM_MAX, Math.round(n))));
  return bars.length > 0 ? bars : undefined;
}

function pickTag(tags: string[][], name: string): string | undefined {
  return tags.find((t) => t[0] === name)?.[1];
}

/** BUD-01 blob address: a hash-named final HTTP(S) path component. */
export function attachmentHttpBlobName(url: URL): { hash: string; extension: string } | undefined {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
  const match = url.pathname.split('/').at(-1)?.match(/^([0-9a-f]{64})(\.[a-z0-9]{1,16})?$/i);
  if (match) return { hash: match[1].toLowerCase(), extension: match[2] ?? '' };
}

/** Prefer the x tag, then the URL's actual blob address, never its query. */
function deriveBlobKey(xTag: string | undefined, url: string): string {
  if (xTag && /^[0-9a-f]{64}$/i.test(xTag)) return xTag.toLowerCase();
  if (url.startsWith('blossom:')) {
    const manifest = parseBlossomUri(url);
    if (manifest) return manifest.sha256;
  }
  try {
    const name = attachmentHttpBlobName(new URL(url));
    if (name) return name.hash;
  } catch { /* An invalid locator has no content hash. */ }
  const slug = url.replace(/[^a-zA-Z0-9]+/g, '_').slice(-80);
  return `url_${slug}`;
}

/** Read the mime from a kind-15 message's tags (no URL/decryption needed). */
export function fileMime(tags: string[][]): string | undefined {
  return pickTag(tags, 'file-type');
}

/**
 * Parse a kind-15 message into renderable metadata. `content` is the file URL
 * (NIP-17 puts it there); the rest comes from tags. Returns null only when the
 * URL or the decryption material is missing — the `x` (ciphertext sha256) tag is
 * **not** required (the Blossom URL already carries the hash, so other clients
 * routinely omit it). If neither supplies a hash, use a local cache key only.
 */
export function findFileMeta(
  content: string,
  tags: string[][],
): FileAttachmentMeta | null {
  const url = content.trim();
  const decryptionKeyHex = pickTag(tags, 'decryption-key');
  const decryptionNonceHex = pickTag(tags, 'decryption-nonce');
  if (!url || !decryptionKeyHex || !decryptionNonceHex) {
    return null;
  }
  const cipherSha256Hex = deriveBlobKey(pickTag(tags, 'x'), url);
  const sizeStr = pickTag(tags, 'size');
  const size = sizeStr ? Number(sizeStr) : undefined;
  const plainSizeStr = pickTag(tags, 'plain-size');
  const plainSize = plainSizeStr ? Number(plainSizeStr) : undefined;
  const durationStr = pickTag(tags, 'duration');
  const durationSec = durationStr ? Number(durationStr) : undefined;
  return {
    url,
    mime: pickTag(tags, 'file-type'),
    name: pickTag(tags, 'name'),
    cipherSha256Hex,
    plainSha256Hex: pickTag(tags, 'ox'),
    size: typeof size === 'number' && Number.isFinite(size) ? size : undefined,
    plainSize:
      typeof plainSize === 'number' && Number.isSafeInteger(plainSize) && plainSize >= 0
        ? plainSize
        : undefined,
    dim: pickTag(tags, 'dim'),
    blurhash: pickTag(tags, 'blurhash'),
    thumbhash: pickTag(tags, 'thumbhash'),
    durationSec:
      typeof durationSec === 'number' && Number.isFinite(durationSec)
        ? durationSec
        : undefined,
    waveform: parseWaveform(pickTag(tags, 'waveform')),
    decryptionKeyHex,
    decryptionNonceHex,
  };
}

/**
 * Human-readable file size (e.g. `1.0 MB`). Returns null for missing/zero sizes
 * so callers can fall back to a placeholder. Shared by the in-flight and the
 * stored file-card bubbles so both read identically.
 */
export function formatFileSize(bytes?: number): string | null {
  if (!bytes || bytes <= 0) return null;
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}
