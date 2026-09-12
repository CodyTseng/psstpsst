import { platform } from '@/platform';

/**
 * Path + type helpers for the local attachment store — the single, flat,
 * content-addressed pool holding decrypted kind-15 attachments (images, video,
 * audio, and arbitrary documents — hence "attachment", not "media"). Ordinary
 * media URLs use Expo's native component caches and never enter this directory.
 *
 * Files live under `documentDirectory` (persistent, not OS-evictable) and are
 * named `{plaintextSha256}{ext}`, so the same content shared across chats is
 * stored once. The `stored_files` table (not the filesystem) is the local-state
 * ledger. Callers store only the **relative** name and rebuild the
 * absolute path with {@link attachmentPath} each time — the `documentDirectory`
 * base embeds an iOS container UUID that changes across reinstalls.
 */
const ATTACHMENT_DIR_NAME = 'psstpsst-files';

export async function attachmentDir(): Promise<string> {
  const base = await platform.fileSystem.documentDirectoryUri();
  if (!base) throw new Error('FileSystem.documentDirectory unavailable');
  return `${base}${ATTACHMENT_DIR_NAME}/`;
}

/** Canonical extension for a known mime → its **correct** extension, even for
 * types iOS can't play/open (e.g. `.wmv`, `.mkv`): a correctly-named file at
 * least shares out and round-trips properly, and is what AVFoundation needs to
 * try the right demuxer (see {@link mimeToExt} for why media needs an extension).
 * This is the curated table; anything not here falls back to the generic subtype
 * (see {@link mimeToExt}), so the closed set just pins the *canonical* spelling
 * (e.g. `video/x-matroska` → `.mkv`, not the subtype `.matroska`). */
const MIME_EXT: Record<string, string> = {
  // Images
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'image/avif': '.avif',
  'image/bmp': '.bmp',
  'image/tiff': '.tiff',
  'image/svg+xml': '.svg',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
  // Video
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/x-m4v': '.m4v',
  'video/3gpp': '.3gp',
  'video/3gpp2': '.3g2',
  'video/mpeg': '.mpeg',
  'video/mp2t': '.ts',
  'video/ogg': '.ogv',
  'video/webm': '.webm',
  'video/x-matroska': '.mkv',
  'video/x-msvideo': '.avi',
  'video/x-ms-wmv': '.wmv',
  'video/x-ms-asf': '.asf',
  'video/x-flv': '.flv',
  // Audio
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/mpeg': '.mp3',
  'audio/aac': '.aac',
  'audio/ogg': '.ogg',
  'audio/opus': '.opus',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/wave': '.wav',
  'audio/flac': '.flac',
  'audio/x-flac': '.flac',
  'audio/webm': '.weba',
  'audio/3gpp': '.3gp',
  'audio/amr': '.amr',
  'audio/midi': '.mid',
  'audio/x-midi': '.mid',
  'audio/x-ms-wma': '.wma',
  // Documents / text / archives
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/html': '.html',
  'text/csv': '.csv',
  'text/markdown': '.md',
  'text/calendar': '.ics',
  'application/json': '.json',
  'application/xml': '.xml',
  'text/xml': '.xml',
  'application/rtf': '.rtf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.oasis.opendocument.text': '.odt',
  'application/vnd.oasis.opendocument.spreadsheet': '.ods',
  'application/vnd.oasis.opendocument.presentation': '.odp',
  'application/epub+zip': '.epub',
  'application/zip': '.zip',
  'application/gzip': '.gz',
  'application/x-tar': '.tar',
  'application/x-7z-compressed': '.7z',
  'application/x-rar-compressed': '.rar',
  'application/vnd.rar': '.rar',
};

export function mimeToExt(mime?: string): string {
  if (!mime) return '';
  const m = mime.split(';')[0].trim().toLowerCase();
  if (MIME_EXT[m]) return MIME_EXT[m];
  // Fall back to the subtype as the extension for ANY structured `type/subtype`
  // (stripping a leading `x-` / `vnd.`): `video/webm` → `.webm`,
  // `application/sketch` → `.sketch`. A media file MUST end up with an extension
  // — iOS AVFoundation determines a local file's container from its path
  // extension, so an extension-less video is "Cannot Open" even when the codec is
  // supported. `octet-stream` (hyphen) and `+`-suffixed types (e.g. `svg+xml`)
  // don't match the alnum subtype, so genuinely-opaque content stays bare.
  const generic = m.match(/^[a-z]+\/(?:x-|vnd\.)?([a-z0-9]{1,8})$/);
  return generic ? `.${generic[1]}` : '';
}

/** Relative on-disk filename for a blob: plaintext sha256 + a real-type ext. */
export function attachmentName(plainSha256Hex: string, mime?: string): string {
  return `${plainSha256Hex}${mimeToExt(mime)}`;
}

/** Absolute path for a stored relative name, rebuilt against the current
 * `documentDirectory` (never persist this — see the module doc). */
export async function attachmentPath(localName: string): Promise<string> {
  return `${await attachmentDir()}${localName}`;
}

export async function ensureAttachmentDir(): Promise<void> {
  const dir = await attachmentDir();
  const info = await platform.fileSystem.stat(dir);
  if (!info.exists) {
    await platform.fileSystem.makeDirectory(dir, { intermediates: true });
  }
}

export async function resolveAttachmentPath(localName: string): Promise<string | null> {
  const path = await attachmentPath(localName);
  const info = await platform.fileSystem.stat(path);
  return info.exists && info.size && info.size > 0 ? path : null;
}

/** The original filename's extension (no dot), lower-cased — used on upload to
 * preserve an unknown type's suffix via the `application/<ext>` mime. */
export function extFromName(name?: string): string | null {
  const m = name?.match(/\.([a-z0-9]{1,8})$/i);
  return m ? m[1].toLowerCase() : null;
}

function tag4(b: Uint8Array, off: number): string {
  if (b.length < off + 4) return '';
  return String.fromCharCode(b[off], b[off + 1], b[off + 2], b[off + 3]);
}

/**
 * Best-effort mime from a buffer's magic bytes — the authoritative type for a
 * decrypted blob (the sender's `file-type` tag is optional and untrusted).
 * Recognises the formats we care about (images, video, audio, pdf); returns
 * null for anything else, so the caller falls back to the message's mime tag.
 */
export function sniffMime(b: Uint8Array): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (tag4(b, 0) === 'GIF8') return 'image/gif';
  if (tag4(b, 0) === '%PDF') return 'application/pdf';
  if (tag4(b, 0) === 'OggS') return 'audio/ogg';
  // EBML header (Matroska / WebM). The DocType that distinguishes them sits
  // deeper; webm is the common case and `.webm` is a fine on-disk extension
  // either way. (AVFoundation can't decode these, but a named file still beats a
  // bare hash — see `mimeToExt`.)
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm';
  if (tag4(b, 0) === 'RIFF') {
    const f = tag4(b, 8);
    if (f === 'WEBP') return 'image/webp';
    if (f === 'WAVE') return 'audio/wav';
    if (f === 'AVI ') return 'video/x-msvideo';
  }
  if (tag4(b, 4) === 'ftyp') {
    const brand = tag4(b, 8);
    if (brand === 'qt  ') return 'video/quicktime';
    if (brand.startsWith('M4A')) return 'audio/mp4';
    if (brand.startsWith('M4V')) return 'video/mp4';
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heim', 'heis'].includes(brand)) {
      return 'image/heic';
    }
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    return 'video/mp4';
  }
  // ID3-tagged or raw-frame MP3 (frame sync, checked last to avoid false hits).
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return 'audio/mpeg';
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return 'audio/mpeg';
  return null;
}
