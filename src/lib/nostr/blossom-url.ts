/**
 * Normalize a Blossom HTTP(S) endpoint using the relay URL conventions.
 * Return URL serialization verbatim after normalizing the path and query.
 */
export function normalizeBlossomUrl(url: string): string {
  url = url.trim();
  if (!url) throw new Error('A media server URL is required.');
  if (!url.includes('://')) {
    const local = url.startsWith('localhost:') || url.startsWith('localhost/') ||
      url.startsWith('127.') || url.startsWith('192.168.');
    url = `${local ? 'http' : 'https'}://${url}`;
  }
  const u = new URL(url);
  u.protocol = u.protocol.toLowerCase();
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`Unsupported server protocol: ${u.protocol}`);
  }
  u.host = u.host.toLowerCase();
  u.pathname = u.pathname.replace(/\/+/g, '/');
  if (u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
  if ((u.port === '80' && u.protocol === 'http:') ||
    (u.port === '443' && u.protocol === 'https:')) u.port = '';
  u.searchParams.sort();
  u.hash = '';
  return u.toString();
}

/** Normalize and deduplicate stored or advertised endpoints in first-seen order. */
export function normalizeBlossomUrls(urls: readonly string[]): string[] {
  const normalized = new Set<string>();
  for (const url of urls) {
    try { normalized.add(normalizeBlossomUrl(url)); } catch { /* Ignore malformed server URLs. */ }
  }
  return [...normalized];
}

/** Last-resort upload target appended when an account did not configure it. */
export const BLOSSOM_UPLOAD_FALLBACK_SERVER = 'https://blossom.jumble.social/';

/**
 * Build the effective upload order without changing the user's published
 * BUD-03 list. Preserve their order and append the fallback only when the same
 * normalized endpoint is not already present.
 */
export function withBlossomUploadFallback(servers: readonly string[]): string[] {
  const hasFallback = servers.some((server) => {
    try {
      return normalizeBlossomUrl(server) === BLOSSOM_UPLOAD_FALLBACK_SERVER;
    } catch {
      return false;
    }
  });
  return hasFallback ? [...servers] : [...servers, BLOSSOM_UPLOAD_FALLBACK_SERVER];
}

/** Keep runtime primary candidates separate from configured mirror targets. */
export function createBlossomUploadPlan(servers: readonly string[]): {
  uploadCandidates: string[];
  mirrorTargets: string[];
} {
  return {
    uploadCandidates: withBlossomUploadFallback(servers),
    mirrorTargets: [...servers],
  };
}

/**
 * Exclude the successful primary and every endpoint that already failed this
 * upload from the subsequent best-effort mirror batch.
 */
export function eligibleBlossomMirrorTargets(
  servers: readonly string[],
  mainServer: string,
  failedServers: ReadonlySet<string>,
): string[] {
  const key = (server: string) => {
    try {
      return normalizeBlossomUrl(server);
    } catch {
      return server.replace(/\/+$/, '');
    }
  };
  const mainKey = key(mainServer);
  const failedKeys = new Set(Array.from(failedServers, key));
  return servers.filter((server) => {
    const serverKey = key(server);
    return serverKey !== mainKey && !failedKeys.has(serverKey);
  });
}

/**
 * Default Blossom media servers, tried in order until one accepts the blob.
 * Used until the account configures its own list (kind 10063).
 */
export const DEFAULT_BLOSSOM_SERVERS = [BLOSSOM_UPLOAD_FALLBACK_SERVER];

/** BUD-03 download bases may be local, but cannot carry URL credentials or suffixes. */
export function normalizeAdvertisedBlossomUrl(value: string): string {
  if (
    typeof value !== 'string' || value.length > 2048 ||
    !/^https?:\/\/[^/]/i.test(value) || /[\s\x00-\x1f\x7f?#\\]/.test(value)
  ) {
    throw new Error('Invalid advertised media server URL');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid advertised media server URL');
  }
  if (!url.hostname || url.username || url.password) {
    throw new Error('Invalid advertised media server URL');
  }
  return normalizeBlossomUrl(url.href);
}
