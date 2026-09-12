/**
 * Normalize a Blossom media-server URL (BUD-03). Unlike DM relays (ws/wss),
 * media servers are plain HTTP(S) endpoints. Lower-cases the host and strips a
 * trailing slash so the same server isn't stored twice under cosmetic variants.
 */
export function normalizeBlossomUrl(url: string): string {
  const u = new URL(url);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`Unsupported server protocol: ${u.protocol}`);
  }
  u.host = u.host.toLowerCase();
  return u.toString().replace(/\/$/, '');
}

/** Last-resort upload target appended when an account did not configure it. */
export const BLOSSOM_UPLOAD_FALLBACK_SERVER = 'https://blossom.jumble.social';

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
