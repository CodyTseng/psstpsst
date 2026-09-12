import { sha256 } from '@noble/hashes/sha2.js';
import { base64 } from '@scure/base';
import type { Event } from 'nostr-tools';

import { platform } from '@/platform';
import { isAbortError, throwIfAborted } from '@/lib/async/abort';
import {
  createBlossomUploadPlan,
  DEFAULT_BLOSSOM_SERVERS,
  eligibleBlossomMirrorTargets,
} from '@/lib/nostr/blossom-url';
import { bytesToHex } from '@/lib/nostr/keys';

import type { Signer } from '../signer/signer.interface';
import { stripImageMetadata } from './strip-metadata';

/**
 * Blossom client (BUD-01 + BUD-02 + BUD-04). Upload tries the account's
 * configured `servers` (kind 10063) in order until one accepts the blob (the
 * "main" copy), then tries Jumble only if all configured attempts fail. A
 * successful main copy is **mirrored** only to the remaining configured
 * servers (BUD-04); the runtime fallback is not a mirror target. Download
 * tries the embedded URL first and, on failure, the same content-addressed
 * blob on each configured server. When `servers` is omitted we start with
 * {@link DEFAULT_BLOSSOM_SERVERS}.
 */

const AUTH_EXPIRATION_SECONDS = 60 * 5;
/** Cap a mirror request so one hung server can't keep the batch pending. */
const MIRROR_TIMEOUT_MS = 20_000;

/** `fetch` with an abort-based timeout (RN `fetch` has none of its own). */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  ms: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Sign a BUD-01 kind-24242 authorization event for an "upload" action. */
async function buildUploadAuth(opts: {
  signer: Signer;
  sha256Hex: string;
  sizeBytes: number;
  content: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const event = await opts.signer.signEvent({
    kind: 24242,
    content: opts.content,
    created_at: now,
    tags: [
      ['t', 'upload'],
      ['x', opts.sha256Hex],
      ['size', String(opts.sizeBytes)],
      ['expiration', String(now + AUTH_EXPIRATION_SECONDS)],
    ],
  });
  return base64.encode(new TextEncoder().encode(JSON.stringify(event)));
}

/** Upload one encrypted blob to one exact planned target. */
export async function uploadEncryptedBlobToServer(opts: {
  signer: Signer;
  cipherFileUri: string;
  cipherSha256Hex: string;
  sizeBytes: number;
  server: string;
  signal?: AbortSignal;
  onProgress?: (sentBytes: number, totalBytes: number) => void;
}): Promise<UploadResult> {
  throwIfAborted(opts.signal);
  const authB64 = await buildUploadAuth({
    signer: opts.signer,
    sha256Hex: opts.cipherSha256Hex,
    sizeBytes: opts.sizeBytes,
    content: 'Upload encrypted Nearby attachment',
  });
  const result = await putBlobToServers({
    servers: [opts.server],
    fileUri: opts.cipherFileUri,
    authB64,
    mime: 'application/octet-stream',
    fallbackSize: opts.sizeBytes,
    signal: opts.signal,
    onProgress: opts.onProgress,
  });
  if (
    result.sha256.toLowerCase() !== opts.cipherSha256Hex ||
    result.size !== opts.sizeBytes
  ) {
    throw new Error('Blossom server returned a mismatched blob descriptor');
  }
  return result;
}

export type UploadResult = {
  url: string;
  sha256: string;
  size: number;
  server: string;
};

type PutBlobResult = UploadResult & {
  failedServers: Set<string>;
};

/** PUT a blob (file at `fileUri`) to the first server that accepts it. */
async function putBlobToServers(opts: {
  servers: string[];
  fileUri: string;
  authB64: string;
  mime: string;
  fallbackSize: number;
  signal?: AbortSignal;
  onProgress?: (sentBytes: number, totalBytes: number) => void;
}): Promise<PutBlobResult> {
  const errors: string[] = [];
  const failedServers = new Set<string>();
  for (const server of opts.servers) {
    throwIfAborted(opts.signal);
    const base = server.replace(/\/+$/, '');
    try {
      const res = await platform.fileSystem.uploadFile(`${base}/upload`, opts.fileUri, {
        httpMethod: 'PUT',
        headers: {
          Authorization: `Nostr ${opts.authB64}`,
          'Content-Type': opts.mime,
        },
        signal: opts.signal,
        onProgress: opts.onProgress,
      });
      if (res.status < 200 || res.status >= 300) {
        failedServers.add(base);
        errors.push(`${server} → ${res.status} ${res.body.slice(0, 120)}`);
        continue;
      }
      const json = JSON.parse(res.body) as { url?: string; sha256?: string; size?: number };
      if (!json.url || !json.sha256) {
        failedServers.add(base);
        errors.push(`${server} → malformed descriptor`);
        continue;
      }
      return {
        url: json.url,
        sha256: json.sha256,
        size: json.size ?? opts.fallbackSize,
        server: base,
        failedServers,
      };
    } catch (err) {
      throwIfAborted(opts.signal);
      if (isAbortError(err)) throw err;
      failedServers.add(base);
      errors.push(`${server} → ${(err as Error).message}`);
    }
  }
  throw new Error(`Blossom upload failed:\n${errors.join('\n')}`);
}

/**
 * BUD-04: ask each target server to **mirror** an already-uploaded blob — a
 * server-to-server copy from `sourceUrl`, so it needs only the URL, not the
 * local bytes. Reuses the upload's kind-24242 auth (same `x`=sha256, `t`=upload).
 * Best-effort: a failed/slow mirror is ignored (the main copy still exists).
 */
async function mirrorBlobToServers(opts: {
  servers: string[];
  sourceUrl: string;
  sha256Hex: string;
  sizeBytes: number;
  mime: string;
  authB64: string;
}): Promise<void> {
  if (opts.servers.length === 0) return;
  await Promise.allSettled(
    opts.servers.map(async (server) => {
      const base = server.replace(/\/+$/, '');
      const res = await fetchWithTimeout(
        `${base}/mirror`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Nostr ${opts.authB64}`,
            'Content-Type': 'application/json',
            'X-SHA-256': opts.sha256Hex,
            'X-Content-Length': String(opts.sizeBytes),
            'X-Content-Type': opts.mime,
          },
          body: JSON.stringify({ url: opts.sourceUrl }),
        },
        MIRROR_TIMEOUT_MS,
      );
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`${base}/mirror → ${res.status}`);
      }
    }),
  );
}

/**
 * Upload an already-encrypted blob (sitting at `cipherFileUri` on disk) to
 * the first Blossom server that accepts it. We use the native file upload
 * rather than fetch+Uint8Array because RN's fetch occasionally mangles binary
 * bodies, while the native upload path is well-tested.
 */
export async function uploadEncryptedBlob(opts: {
  signer: Signer;
  cipherFileUri: string;
  cipherSha256Hex: string;
  sizeBytes: number;
  servers?: string[];
  signal?: AbortSignal;
  onProgress?: (sentBytes: number, totalBytes: number) => void;
}): Promise<UploadResult> {
  throwIfAborted(opts.signal);
  const configuredServers = opts.servers ?? DEFAULT_BLOSSOM_SERVERS;
  const { uploadCandidates, mirrorTargets } = createBlossomUploadPlan(configuredServers);
  // The blob is AES-GCM ciphertext, not the original file — upload it as opaque
  // bytes. Sending the real mime would leak the attachment type to the server
  // (the whole point of E2E-encrypting it) and mislabels ciphertext as e.g. a
  // JPEG. The real type stays private in the kind-15 `file-type` tag.
  const mime = 'application/octet-stream';
  const authB64 = await buildUploadAuth({
    signer: opts.signer,
    sha256Hex: opts.cipherSha256Hex,
    sizeBytes: opts.sizeBytes,
    content: 'Upload encrypted DM attachment',
  });
  throwIfAborted(opts.signal);
  const main = await putBlobToServers({
    servers: uploadCandidates,
    fileUri: opts.cipherFileUri,
    authB64,
    mime,
    fallbackSize: opts.sizeBytes,
    signal: opts.signal,
    onProgress: opts.onProgress,
  });
  throwIfAborted(opts.signal);
  // Replicate to the other servers in the background — never block the send on
  // it (and it's a server-to-server copy, so it doesn't need the local file).
  void mirrorBlobToServers({
    // The runtime fallback is a last-resort primary only. Do not mirror to it
    // when one of the account's configured servers accepted the upload.
    servers: eligibleBlossomMirrorTargets(
      mirrorTargets,
      main.server,
      main.failedServers,
    ),
    sourceUrl: main.url,
    sha256Hex: opts.cipherSha256Hex,
    sizeBytes: opts.sizeBytes,
    mime,
    authB64,
  }).catch(() => {});
  return main;
}

/**
 * Upload a PUBLIC (unencrypted) image — e.g. profile media or custom emoji — to
 * Blossom. Unlike DM attachments, the plaintext bytes are intentionally
 * world-readable.
 */
export async function uploadPublicImage(opts: {
  signer: Signer;
  fileUri: string;
  mime?: string;
  servers?: string[];
  authContent?: string;
  metadataStripped?: boolean;
  /** Skip metadata re-encoding when it would destroy source semantics such as animation. */
  preserveSourceBytes?: boolean;
}): Promise<UploadResult> {
  // Public images are world-readable, so stripping EXIF/GPS matters even more
  // than for an encrypted message attachment. Re-encode unless the caller has
  // already produced a clean output. A caller may explicitly preserve source
  // bytes when re-encoding would destroy content such as animation. Otherwise
  // the result is JPEG (or PNG for a PNG source), so the mime follows.
  // Best-effort: fall back to the original file and delete temporary output.
  let fileUri = opts.fileUri;
  let mime = opts.mime ?? 'image/jpeg';
  let strippedUri: string | null = null;
  try {
    const stripped = opts.metadataStripped || opts.preserveSourceBytes
      ? null
      : await stripImageMetadata(opts.fileUri, mime).catch(() => null);
    if (stripped) {
      fileUri = stripped.uri;
      strippedUri = stripped.uri;
      mime = mime === 'image/png' ? 'image/png' : 'image/jpeg';
    }

    const b64 = await platform.fileSystem.readBase64(fileUri);
    const bytes = base64.decode(b64);
    const sha256Hex = bytesToHex(sha256(bytes));
    const configuredServers = opts.servers ?? DEFAULT_BLOSSOM_SERVERS;
    const { uploadCandidates, mirrorTargets } = createBlossomUploadPlan(configuredServers);
    const authB64 = await buildUploadAuth({
      signer: opts.signer,
      sha256Hex,
      sizeBytes: bytes.length,
      content: opts.authContent ?? 'Upload public image',
    });
    const main = await putBlobToServers({
      servers: uploadCandidates,
      fileUri,
      authB64,
      mime,
      fallbackSize: bytes.length,
    });
    void mirrorBlobToServers({
      // Keep the last-resort Jumble candidate out of replication unless it was
      // explicitly present in the account's configured list.
      servers: eligibleBlossomMirrorTargets(
        mirrorTargets,
        main.server,
        main.failedServers,
      ),
      sourceUrl: main.url,
      sha256Hex,
      sizeBytes: bytes.length,
      mime,
      authB64,
    }).catch(() => {});
    return main;
  } finally {
    if (strippedUri) {
      await platform.fileSystem.delete(strippedUri, { idempotent: true }).catch(() => {});
    }
  }
}

/** Download blob bytes from a Blossom URL (or any HTTP(S) URL). */
export async function downloadBlob(url: string): Promise<Uint8Array> {
  const response = await platform.fileSystem.requestRemoteFile(url, { method: 'GET' });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Download failed ${response.status} for ${url}`);
  }
  return response.body;
}

/**
 * Extract the sha256 (the content address) from a Blossom URL: the last 64-hex
 * run in its path, or null if there is none. A URL with no hash isn't a Blossom
 * resource — it can't be re-fetched by hash on another server. Mirrors
 * blossom-client-sdk's `getHashFromURL`.
 */
function getHashFromURL(url: string): string | null {
  try {
    const hashes = Array.from(new URL(url).pathname.matchAll(/[0-9a-f]{64}/gi));
    return hashes.length > 0 ? hashes[hashes.length - 1][0] : null;
  } catch {
    return null;
  }
}

/**
 * Download a content-addressed blob, falling back across servers. Tries the
 * embedded `url` first, then — **only when `url` is a Blossom resource** (its
 * path carries a sha256 content address) — the same blob on each configured
 * server (BUD-04 mirrors land it there), so a dead/rotated original host doesn't
 * break the attachment. A non-Blossom URL is fetched as-is with no cross-server
 * retry, since rebuilding `{server}/{sha}` would fetch the wrong thing.
 *
 * The hash is taken **from the URL itself** (`getHashFromURL`), never from a
 * tag — attachments from other Nostr clients may omit the `x`/`ox` hash tags,
 * so we can't rely on knowing the hash out-of-band. The original file extension
 * (if any) is kept since some servers serve `/{sha}.{ext}`. Dedupes by origin.
 */
export async function downloadBlobWithFallback(opts: {
  url: string;
  servers: string[];
}): Promise<Uint8Array> {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (u: string) => {
    const key = u.replace(/\/+$/, '');
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push(u);
    }
  };
  add(opts.url);

  // Only a Blossom (content-addressed) URL can be re-fetched by hash elsewhere.
  const hash = getHashFromURL(opts.url);
  if (hash) {
    const ext = new URL(opts.url).pathname.match(/\.\w+$/i)?.[0] ?? '';
    for (const server of opts.servers) {
      add(`${server.replace(/\/+$/, '')}/${hash}${ext}`);
    }
  }

  const errors: string[] = [];
  for (const url of candidates) {
    try {
      return await downloadBlob(url);
    } catch (err) {
      errors.push(`${url} → ${(err as Error).message}`);
    }
  }
  throw new Error(`Download failed (all servers):\n${errors.join('\n')}`);
}

export type BlossomDescriptor = Event;
