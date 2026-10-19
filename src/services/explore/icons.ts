import { base64 } from '@scure/base';
import { platform } from '@/platform';
import { resourceMime, type NappletRelease } from '@/services/napplet/protocol';
import { loadSiteBlob, loadIcon } from '@/services/napplet/artifacts';
import type { SiteFile } from './model';

export type WebsiteIconSource = { origin?: string; key?: string };
export type ApplicationIconSource = Pick<NappletRelease, 'icon' | 'servers'> & WebsiteIconSource & {
  manifest?: { id: string };
  files?: readonly SiteFile[];
};

/** Website presentation carries an origin; launcher entries carry their URL key. */
export function websiteIconOrigin(source: WebsiteIconSource): string | undefined {
  const value = source.origin ?? source.key;
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return url.origin;
  } catch { /* Signed application identifiers are not website URLs. */ }
  return undefined;
}

type IconCandidate = { url: string; size: number };
const MAX_ICON_BYTES = 512 * 1024;

function iconUrl(value: string, base: string): string | undefined {
  try {
    const url = new URL(value.replace(/&amp;/g, '&'), base);
    if (url.href.length <= 4096 && ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return url.href;
  } catch { /* Ignore malformed website metadata. */ }
  return undefined;
}
function iconSize(value: string, fallback: number): number {
  if (/\bany\b/i.test(value)) return 2048;
  let size = fallback;
  for (const match of value.matchAll(/(\d{1,5})x(\d{1,5})/gi)) size = Math.max(size, Math.min(Number(match[1]), Number(match[2]), 2048));
  return size;
}
type IconReader = (url: string, maxBytes: number, signal: AbortSignal) => Promise<Uint8Array>;
type IconDiscovery = {
  read: IconReader;
  index?: string;
  accepts?: (url: string) => boolean;
  manifest?: string;
  candidates?: IconCandidate[];
};
async function fetchIcon(origin: string, signal: AbortSignal, discovery: IconDiscovery): Promise<string | undefined> {
  const candidates: IconCandidate[] = [];
  let manifest: string | undefined;
  const accepts = discovery.accepts ?? (() => true);
  try {
    const bytes = await discovery.read(discovery.index ?? `${origin}/`, MAX_ICON_BYTES, signal);
    const html = new TextDecoder().decode(bytes.subarray(0, MAX_ICON_BYTES));
    for (const match of html.matchAll(/<link\b[^>]{0,4096}>/gi)) {
      const attrs = new Map<string, string>();
      for (const attr of match[0].matchAll(/([^\s=<>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
        attrs.set(attr[1].toLowerCase(), attr[2] ?? attr[3] ?? attr[4]);
      }
      const rel = (attrs.get('rel') ?? '').toLowerCase().split(/\s+/);
      const url = iconUrl(attrs.get('href') ?? '', origin);
      if (!url || !attrs.get('href') || !accepts(url)) continue;
      if (rel.includes('manifest')) manifest ??= url;
      if (rel.includes('icon') || rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed')) {
        const fallback = rel.some(value => value.startsWith('apple-touch-icon')) ? 180 : 32;
        candidates.push({ url, size: iconSize(attrs.get('sizes') ?? '', attrs.get('type') === 'image/svg+xml' ? 2048 : fallback) });
      }
      if (candidates.length >= 32) break;
    }
  } catch { /* Conventional icon paths remain available without page metadata. */ }
  manifest ??= discovery.manifest;
  if (manifest && !signal.aborted) {
    try {
      const bytes = await discovery.read(manifest, 64 * 1024, signal);
      const data: unknown = JSON.parse(new TextDecoder().decode(bytes));
      const icons = data && typeof data === 'object' && 'icons' in data ? data.icons : undefined;
      if (Array.isArray(icons)) for (const icon of icons.slice(0, 32)) {
        if (!icon || typeof icon.src !== 'string') continue;
        const url = iconUrl(icon.src, manifest);
        if (url && accepts(url)) candidates.push({ url, size: iconSize(typeof icon.sizes === 'string' ? icon.sizes : '', icon.type === 'image/svg+xml' ? 2048 : 192) });
      }
    } catch { /* A malformed manifest must not hide ordinary website icons. */ }
  }
  candidates.push({ url: `${origin}/apple-touch-icon.png`, size: 180 }, { url: `${origin}/favicon.ico`, size: 16 });
  candidates.push(...discovery.candidates ?? []);
  candidates.sort((a, b) => b.size - a.size);
  const tried = new Set<string>();
  for (const candidate of candidates) {
    if (signal.aborted || tried.size >= 4) break;
    if (tried.has(candidate.url) || !accepts(candidate.url)) continue;
    tried.add(candidate.url);
    try {
      const bytes = await discovery.read(candidate.url, MAX_ICON_BYTES, signal);
      if (!bytes.length || bytes.length > MAX_ICON_BYTES) continue;
      const mime = resourceMime(bytes);
      if (['image/x-icon', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'].includes(mime)) {
        return `data:${mime};base64,${base64.encode(bytes)}`;
      }
    } catch { /* Try the next best icon when a candidate is unavailable. */ }
  }
  return undefined;
}

const cache = new Map<string, { expires: number; value: Promise<string | undefined> }>();
const jobs: (() => void)[] = [];
let active = 0;
const next = () => { if (active < 4) jobs.shift()?.(); };

function cachedIcon(key: string, load: (signal: AbortSignal) => Promise<string | undefined>): Promise<string | undefined> {
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  if (jobs.length >= 64) return Promise.resolve(undefined);
  if (cache.size >= 128) cache.delete(cache.keys().next().value!);
  const entry = { expires: Infinity, value: Promise.resolve<string | undefined>(undefined) };
  entry.value = new Promise(resolve => {
    jobs.push(() => {
      active++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      void load(controller.signal)
        .catch(() => undefined)
        .then(value => {
          entry.expires = Date.now() + (value ? 60 : 5) * 60000;
          resolve(value);
        })
        .finally(() => { clearTimeout(timer); active--; next(); });
    });
    next();
  });
  cache.set(key, entry);
  return entry.value;
}

/** Discover website icons without sending account credentials or using third-party proxies. */
export function loadWebsiteIcon(origin: string): Promise<string | undefined> {
  const canonical = websiteIconOrigin({ origin });
  if (!canonical) return Promise.resolve(undefined);
  return cachedIcon(canonical, signal => fetchIcon(canonical, signal, {
    read: (url, max, requestSignal) => platform.napplet.fetchResource(url, max, requestSignal),
  }));
}

export function applicationIconKey(source: ApplicationIconSource): string {
  return websiteIconOrigin(source) ?? source.manifest?.id ?? `${source.icon?.hash ?? ''}:${source.icon?.mime ?? ''}`;
}

/** Signed sites discover artwork only through their verified file map. */
export function loadApplicationIcon(source: ApplicationIconSource): Promise<string | undefined> {
  const origin = websiteIconOrigin(source);
  if (origin) return loadWebsiteIcon(origin);
  if (!source.files || !source.manifest) return loadIcon(source);
  return cachedIcon(`site:${source.manifest.id}`, async signal => {
    if (source.icon) {
      const declared = await loadIcon(source);
      if (declared) return declared;
    }
    const base = 'https://bundle.invalid';
    const files = new Map(source.files!.map(file => [file.path, file]));
    const fileFor = (value: string) => {
      try {
        const url = new URL(value);
        return url.origin === base ? files.get(decodeURIComponent(url.pathname)) : undefined;
      } catch { return undefined; }
    };
    const manifestPath = ['/manifest.webmanifest', '/site.webmanifest', '/manifest.json'].find(path => files.has(path));
    const candidates = ['/favicon.svg', '/favicon.png'].filter(path => files.has(path))
      .map(path => ({ url: `${base}${path}`, size: path.endsWith('.svg') ? 2048 : 32 }));
    return fetchIcon(base, signal, {
      index: `${base}/index.html`,
      accepts: value => !!fileFor(value),
      manifest: manifestPath ? `${base}${manifestPath}` : undefined,
      candidates,
      read: (url, maxBytes, requestSignal) => {
        const file = fileFor(url);
        if (!file) return Promise.reject(new Error('unsigned-icon-resource'));
        return loadSiteBlob(source, file.hash, requestSignal, maxBytes);
      },
    });
  });
}
