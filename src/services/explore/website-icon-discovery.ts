import { platform } from '@/platform';
import { resourceMime } from '@/services/napplet/protocol';
import type { ResourceResponse, ResourceValidators } from '@/platform/ports/napplet';

export type DownloadedWebsiteIcon = ResourceResponse & { url: string; mime: string };

/** Retain public-DNS validation and credential isolation for every icon request. */
export async function requestWebsiteIcon(url: string, maxBytes: number, signal: AbortSignal, validators?: ResourceValidators): Promise<ResourceResponse> {
  if (platform.napplet.fetchResourceResponse) return platform.napplet.fetchResourceResponse(url, maxBytes, signal, validators);
  return { status: 200, bytes: await platform.napplet.fetchResource(url, maxBytes, signal) };
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
export async function discoverWebsiteIcon(origin: string, signal: AbortSignal): Promise<DownloadedWebsiteIcon | undefined> {
  const read: IconReader = async (url, max, requestSignal) => (await requestWebsiteIcon(url, max, requestSignal)).bytes;
  const candidates: IconCandidate[] = [];
  let manifest: string | undefined;
  try {
    const bytes = await read(`${origin}/`, MAX_ICON_BYTES, signal);
    const html = new TextDecoder().decode(bytes.subarray(0, MAX_ICON_BYTES));
    for (const match of html.matchAll(/<link\b[^>]{0,4096}>/gi)) {
      const attrs = new Map<string, string>();
      for (const attr of match[0].matchAll(/([^\s=<>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
        attrs.set(attr[1].toLowerCase(), attr[2] ?? attr[3] ?? attr[4]);
      }
      const rel = (attrs.get('rel') ?? '').toLowerCase().split(/\s+/);
      const url = iconUrl(attrs.get('href') ?? '', origin);
      if (!url || !attrs.get('href')) continue;
      if (rel.includes('manifest')) manifest ??= url;
      if (rel.includes('icon') || rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed')) {
        const fallback = rel.some(value => value.startsWith('apple-touch-icon')) ? 180 : 32;
        candidates.push({ url, size: iconSize(attrs.get('sizes') ?? '', attrs.get('type') === 'image/svg+xml' ? 2048 : fallback) });
      }
      if (candidates.length >= 32) break;
    }
  } catch { /* Conventional icon paths remain available without page metadata. */ }
  if (manifest && !signal.aborted) {
    try {
      const bytes = await read(manifest, 64 * 1024, signal);
      const data: unknown = JSON.parse(new TextDecoder().decode(bytes));
      const icons = data && typeof data === 'object' && 'icons' in data ? data.icons : undefined;
      if (Array.isArray(icons)) for (const icon of icons.slice(0, 32)) {
        if (!icon || typeof icon.src !== 'string') continue;
        const url = iconUrl(icon.src, manifest);
        if (url) candidates.push({ url, size: iconSize(typeof icon.sizes === 'string' ? icon.sizes : '', icon.type === 'image/svg+xml' ? 2048 : 192) });
      }
    } catch { /* A malformed manifest must not hide ordinary website icons. */ }
  }
  candidates.push({ url: `${origin}/apple-touch-icon.png`, size: 180 }, { url: `${origin}/favicon.ico`, size: 16 });
  candidates.sort((a, b) => b.size - a.size);
  const tried = new Set<string>();
  for (const candidate of candidates) {
    if (signal.aborted || tried.size >= 4) break;
    if (tried.has(candidate.url)) continue;
    tried.add(candidate.url);
    try {
      const response = await requestWebsiteIcon(candidate.url, MAX_ICON_BYTES, signal);
      if (response.status !== 200) continue;
      const { bytes } = response;
      if (!bytes.length || bytes.length > MAX_ICON_BYTES) continue;
      const mime = resourceMime(bytes);
      if (['image/x-icon', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'].includes(mime)) {
        return { ...response, url: candidate.url, mime };
      }
    } catch { /* Try the next best icon when a candidate is unavailable. */ }
  }
  return undefined;
}

