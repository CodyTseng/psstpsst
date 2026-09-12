import { platform } from '@/platform';

const cached = new Map<string, string>();
const checks = new Map<string, Promise<string | null>>();
const downloads = new Map<string, Promise<string>>();
const MAX_CACHED_IMAGES = 512;
const listeners = new Map<string, Set<(uri: string) => void>>();

function remember(url: string, uri: string) {
  cached.delete(url);
  cached.set(url, uri);
  if (cached.size > MAX_CACHED_IMAGES) cached.delete(cached.keys().next().value!);
  for (const listener of listeners.get(url) ?? []) listener(uri);
  return uri;
}

/** Memory-only reads never authorize a URL request. Values are local file URIs. */
export function getSessionImageUri(url: string): string | null {
  return cached.get(url) ?? null;
}

export function getCachedImageUri(url: string): Promise<string | null> {
  const uri = getSessionImageUri(url);
  if (uri) return Promise.resolve(uri);
  const downloading = downloads.get(url);
  if (downloading) return downloading;
  let pending = checks.get(url);
  if (!pending) {
    pending = platform.imageCache.getCachedUri(url).then((local) => local ? remember(url, local) : null)
      .finally(() => checks.delete(url));
    checks.set(url, pending);
  }
  return pending;
}

export function isImageDownloading(url: string): boolean {
  return downloads.has(url);
}

/** Call only after contact policy or an explicit tap permits downloading. */
export function downloadImage(url: string): Promise<string> {
  let pending = downloads.get(url);
  if (!pending) {
    pending = platform.imageCache.download(url).then((uri) => remember(url, uri))
      .finally(() => downloads.delete(url));
    downloads.set(url, pending);
  }
  return pending;
}

/** Only mounted users of this URL are notified when another row resolves it. */
export function subscribeImageCache(url: string, listener: (uri: string) => void): () => void {
  let subscribers = listeners.get(url);
  if (!subscribers) {
    subscribers = new Set();
    listeners.set(url, subscribers);
  }
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
    if (subscribers.size === 0) listeners.delete(url);
  };
}
