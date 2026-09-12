import { normalizeBlossomUrl } from './blossom-url';

export type BlossomUri = {
  sha256: string;
  extension: string;
  servers: string[];
  authors: string[];
  size?: number;
};

const HASHED_NAME = /^([0-9a-f]{64})(\.[a-z0-9]{1,16})$/;

/** Build the immutable BUD-10 locator used by Nearby encrypted attachments. */
export function buildBlossomUri(sha256: string, servers: readonly string[]): string {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('Invalid Blossom content hash');
  const params = new URLSearchParams();
  const seen = new Set<string>();
  for (const value of servers) {
    const server = normalizeBlossomUrl(value);
    if (seen.has(server)) continue;
    seen.add(server);
    params.append('xs', server);
  }
  if (seen.size === 0) throw new Error('A Blossom URI requires at least one server');
  return `blossom:${sha256}.bin?${params.toString()}`;
}

/** Strictly parse a BUD-10 URI without treating its hints as trusted bytes. */
export function parseBlossomUri(value: string): BlossomUri | null {
  if (!value.startsWith('blossom:') || value.startsWith('blossom://')) return null;
  let uri: URL;
  try {
    uri = new URL(value);
  } catch {
    return null;
  }
  if (uri.protocol !== 'blossom:' || uri.username || uri.password || uri.host || uri.hash) {
    return null;
  }
  const name = uri.pathname.match(HASHED_NAME);
  if (!name) return null;

  const servers: string[] = [];
  const seenServers = new Set<string>();
  for (const hint of uri.searchParams.getAll('xs')) {
    try {
      const candidates = /^[a-z][a-z0-9+.-]*:/i.test(hint)
        ? [normalizeBlossomUrl(hint)]
        : [`https://${hint}`, `http://${hint}`].map((value) => {
            const parsed = new URL(value);
            if (
              parsed.username ||
              parsed.password ||
              parsed.pathname !== '/' ||
              parsed.search ||
              parsed.hash
            ) {
              throw new Error('Invalid scheme-less Blossom server');
            }
            return normalizeBlossomUrl(value);
          });
      for (const server of candidates) {
        if (seenServers.has(server)) continue;
        seenServers.add(server);
        servers.push(server);
      }
    } catch {
      return null;
    }
  }

  const authors = uri.searchParams.getAll('as');
  if (authors.some((author) => !/^[0-9a-f]{64}$/.test(author))) return null;
  const sizes = uri.searchParams.getAll('sz');
  if (sizes.length > 1 || (sizes[0] != null && !/^[1-9]\d*$/.test(sizes[0]))) return null;
  const size = sizes[0] == null ? undefined : Number(sizes[0]);
  if (size != null && !Number.isSafeInteger(size)) return null;

  return {
    sha256: name[1],
    extension: name[2],
    servers,
    authors,
    size,
  };
}

/** Concrete HTTP locations derived only from authenticated `xs` hints. */
export function blossomDownloadUrls(uri: BlossomUri): string[] {
  return uri.servers.map((server) =>
    new URL(`${uri.sha256}${uri.extension}`, `${server.replace(/\/+$/, '')}/`).toString(),
  );
}
