export type EmbeddedMediaKind = 'image' | 'video' | 'audio';

export type EmbeddedMedia = {
  url: string;
  kind: EmbeddedMediaKind;
  mime?: string;
  /** Expected sha256 of the remote plaintext bytes (`x` in NIP-92 imeta).
   * Used as a stable native image-cache key; ordinary URL media is not copied
   * into PsstPsst's persistent attachment store. */
  sha256?: string;
  size?: number;
  width?: number;
  height?: number;
  blurhash?: string;
  thumbhash?: string;
  alt?: string;
  durationSec?: number;
  /** Playlist/stream source rather than one downloadable media file. */
  streaming?: boolean;
};

type PartialMedia = Omit<EmbeddedMedia, 'kind'> & { kind?: EmbeddedMediaKind };

const IMAGE_EXTENSIONS = new Set([
  'avif',
  'bmp',
  'gif',
  'heic',
  'heif',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'webp',
]);
// Container suffixes are only a provisional classification. Once tapped, the
// native player inspects their tracks and can present an audio-only UI.
const VIDEO_OR_CONTAINER_EXTENSIONS = new Set([
  '3gp',
  'm3u8',
  'm4v',
  'mov',
  'mp4',
  'ogg',
  'ogv',
  'webm',
]);
const AUDIO_EXTENSIONS = new Set(['aac', 'flac', 'm4a', 'mp3', 'oga', 'opus', 'wav', 'wma']);

function mediaKindFromMime(mime?: string): EmbeddedMediaKind | undefined {
  const normalized = mime?.trim().toLowerCase();
  if (normalized?.startsWith('image/')) return 'image';
  if (normalized?.startsWith('video/')) return 'video';
  if (normalized?.startsWith('audio/')) return 'audio';
  if (normalized === 'application/vnd.apple.mpegurl' || normalized === 'application/x-mpegurl') {
    return 'video';
  }
  return undefined;
}

function extensionFromUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const filename = parsed.searchParams.get('filename') ?? parsed.pathname.split('/').pop() ?? '';
    const withoutSuffix = filename.split(/[?#]/, 1)[0];
    const extension = withoutSuffix.match(/\.([a-z0-9]+)$/i)?.[1];
    return extension?.toLowerCase();
  } catch {
    return undefined;
  }
}

function mediaKindFromUrl(url: string): EmbeddedMediaKind | undefined {
  const extension = extensionFromUrl(url);
  if (!extension) return undefined;
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (VIDEO_OR_CONTAINER_EXTENSIONS.has(extension)) return 'video';
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  return undefined;
}

function mediaMimeFromUrl(url: string): string | undefined {
  const extension = extensionFromUrl(url);
  if (!extension) return undefined;
  const mimeByExtension: Record<string, string> = {
    avif: 'image/avif',
    bmp: 'image/bmp',
    gif: 'image/gif',
    heic: 'image/heic',
    heif: 'image/heif',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    png: 'image/png',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    '3gp': 'video/3gpp',
    m3u8: 'application/vnd.apple.mpegurl',
    m4v: 'video/x-m4v',
    mov: 'video/quicktime',
    mp4: 'video/mp4',
    ogg: 'video/ogg',
    ogv: 'video/ogg',
    webm: 'video/webm',
    aac: 'audio/aac',
    flac: 'audio/flac',
    m4a: 'audio/mp4',
    mp3: 'audio/mpeg',
    oga: 'audio/ogg',
    opus: 'audio/opus',
    wav: 'audio/wav',
    wma: 'audio/x-ms-wma',
  };
  return mimeByExtension[extension];
}

function canonicalUrl(url: string): string | null {
  const href = url.startsWith('www.') ? `https://${url}` : url;
  try {
    const parsed = new URL(href);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function parseDim(value?: string): Pick<EmbeddedMedia, 'width' | 'height'> {
  const match = value?.trim().match(/^(\d+)x(\d+)$/i);
  if (!match) return {};
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    return {};
  }
  return { width, height };
}

function positiveNumber(value?: string): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function sha256(value?: string): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[0-9a-f]{64}$/.test(normalized) ? normalized : undefined;
}

function applyField(meta: PartialMedia, key: string, value: string): void {
  switch (key.toLowerCase()) {
    case 'url':
      meta.url = value;
      break;
    case 'm':
    case 'mime':
    case 'file-type':
      meta.mime = value;
      meta.kind = mediaKindFromMime(value) ?? meta.kind;
      break;
    case 'x':
      meta.sha256 = sha256(value);
      break;
    case 'size':
      meta.size = positiveNumber(value);
      break;
    case 'dim':
      Object.assign(meta, parseDim(value));
      break;
    case 'blurhash':
      meta.blurhash = value;
      break;
    case 'thumbhash':
      meta.thumbhash = value;
      break;
    case 'alt':
      meta.alt = value;
      break;
    case 'duration':
      meta.durationSec = positiveNumber(value);
      break;
  }
}

function parseImeta(tag: string[]): PartialMedia | null {
  if (tag[0] !== 'imeta') return null;
  const meta: PartialMedia = { url: '' };
  for (let index = 1; index < tag.length; index++) {
    const part = tag[index].trim();
    const separator = part.search(/\s/);
    if (separator <= 0) continue;
    const key = part.slice(0, separator);
    const value = part.slice(separator).trim();
    if (value) applyField(meta, key, value);
  }
  return meta.url ? meta : null;
}

function flatTagMeta(tags: string[][], onlyUrl: string): PartialMedia | null {
  const taggedUrl = tags.find((tag) => tag[0] === 'url')?.[1];
  if (taggedUrl && canonicalUrl(taggedUrl) !== canonicalUrl(onlyUrl)) return null;

  const meta: PartialMedia = { url: onlyUrl };
  let found = false;
  for (const tag of tags) {
    if (tag.length < 2) continue;
    if (
      ![
        'm',
        'mime',
        'file-type',
        'x',
        'size',
        'dim',
        'blurhash',
        'thumbhash',
        'alt',
        'duration',
      ].includes(tag[0])
    ) {
      continue;
    }
    found = true;
    applyField(meta, tag[0], tag[1]);
  }
  return found ? meta : null;
}

/**
 * Resolve media metadata for the HTTP(S) URLs that actually occur in message
 * content. NIP-92 `imeta` is authoritative (notably for signed URLs without a
 * file extension); a conservative extension allowlist is the offline fallback.
 * No HEAD request is made, so rendering remains O(tags + URLs) and network-free.
 */
export function embeddedMediaByUrl(urls: string[], tags?: string[][] | null): Map<string, EmbeddedMedia> {
  const uniqueUrls = Array.from(new Set(urls));
  if (uniqueUrls.length === 0) return new Map();

  const tagList = tags ?? [];
  const imeta = new Map<string, PartialMedia>();
  for (const tag of tagList) {
    const parsed = parseImeta(tag);
    const key = parsed ? canonicalUrl(parsed.url) : null;
    if (parsed && key) imeta.set(key, parsed);
  }

  const loneFlatMeta = uniqueUrls.length === 1 ? flatTagMeta(tagList, uniqueUrls[0]) : null;
  const result = new Map<string, EmbeddedMedia>();

  for (const href of uniqueUrls) {
    const key = canonicalUrl(href);
    if (!key) continue;
    const tagged = imeta.get(key) ?? loneFlatMeta ?? undefined;
    const mime = tagged?.mime ?? mediaMimeFromUrl(key);
    const kind = tagged?.kind ?? mediaKindFromMime(mime) ?? mediaKindFromUrl(key);
    if (!kind) continue;
    const normalizedMime = mime?.trim().toLowerCase();
    result.set(href, {
      url: href,
      kind,
      mime,
      sha256: tagged?.sha256,
      size: tagged?.size,
      width: tagged?.width,
      height: tagged?.height,
      blurhash: tagged?.blurhash,
      thumbhash: tagged?.thumbhash,
      alt: tagged?.alt,
      durationSec: tagged?.durationSec,
      streaming:
        extensionFromUrl(key) === 'm3u8' ||
        normalizedMime === 'application/vnd.apple.mpegurl' ||
        normalizedMime === 'application/x-mpegurl',
    });
  }

  return result;
}
