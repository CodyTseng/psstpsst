import { decodeNappletHtml } from '@/platform/napplet-bytes';
import { assertNotAborted } from '@/platform/abort';
import { base64 } from '@scure/base';
import { platform } from '@/platform';
import type { ResourceProgress } from '@/platform/ports/napplet';
import type { Event } from 'nostr-tools';
import { eventKey, eventKeyAddress, normalizeEventKey } from '@/lib/nostr/event-key';
import { MAX_ARTIFACT_BYTES, publicUrl, resourceMime, type NappletRelease } from './protocol';

export type ArtifactProgress = ResourceProgress & { phase: 'downloading' | 'verifying' | 'preparing'; files?: { ready: number; total: number } };
type ArtifactManifest = Pick<Event, 'id' | 'kind' | 'pubkey' | 'tags'>;
export type ArtifactSource = Pick<NappletRelease, 'servers'> & {
  eventKey?: string;
  event?: ArtifactManifest;
  manifest?: ArtifactManifest;
};

export type ArtifactMetadata = {
  schemaVersion: 1;
  appId: string;
  versions: Record<string, { files: string[]; complete?: true }>;
  icon?: { path: string; sourceHash: string; manifestId: string };
};

function applicationId(source: ArtifactSource): string {
  if (source.eventKey) return normalizeEventKey(source.eventKey);
  const event = source.manifest ?? source.event;
  if (event) return eventKey(event);
  throw new Error('missing-application-id');
}

async function applicationDirectory(source: ArtifactSource) {
  const id = applicationId(source);
  const root = await platform.fileSystem.documentDirectoryUri();
  if (!root) throw new Error('storage-unavailable');
  // Long identifiers can exceed a filesystem's per-component limit.
  // Preserve existing cache directories and encode coordinate punctuation for Windows.
  const encoded = eventKeyAddress(id);
  const name = encoded.length <= 240 ? encoded : `app-${await platform.deviceCrypto.sha256Hex(new TextEncoder().encode(encoded))}`;
  const directory = `${root.replace(/\/$/, '')}/app-artifacts/${name}`;
  await platform.fileSystem.makeDirectory(`${directory}/files`, { intermediates: true, idempotent: true });
  if (name !== encoded) await platform.fileSystem.writeText(`${directory}/app-id.txt`, id);
  return { id, root, directory };
}

async function artifactPaths(source: ArtifactSource, hash: string, extension: 'html' | 'blob') {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('invalid-hash');
  const { root, directory } = await applicationDirectory(source);
  return {
    path: `${directory}/files/${hash}.${extension}`,
    legacy: [`${directory}/${hash}.${extension}`, `${root.replace(/\/$/, '')}/napplets/${hash}.${extension}`],
  };
}

function manifestId(source: ArtifactSource): string {
  const id = (source.manifest ?? source.event)?.id;
  if (!id || !/^[a-f0-9]{64}$/.test(id)) throw new Error('missing-manifest-id');
  return id;
}

/** Cache metadata never supplies identity, permissions or authoritative runtime files. */
export async function recordArtifactVersion(source: ArtifactSource, files: string[], complete: boolean): Promise<void> {
  if (files.length > 513 || files.some(file => !/^files\/[a-f0-9]{64}\.(html|blob)$/.test(file))) throw new Error('invalid-artifact-files');
  const version = manifestId(source);
  const { id, directory } = await applicationDirectory(source);
  await platform.fileSystem.updateJson(`${directory}/metadata.json`, {
    schemaVersion: 1, appId: id,
    // An incomplete attempt must never downgrade a previously completed version.
    versions: { [version]: { files: [...new Set(files)], ...(complete ? { complete: true } : {}) } },
  });
}

export async function readArtifactMetadata(source: ArtifactSource): Promise<ArtifactMetadata | undefined> {
  const { id, directory } = await applicationDirectory(source);
  const path = `${directory}/metadata.json`;
  const stat = await platform.fileSystem.stat(path);
  if (!stat.exists || stat.size != null && stat.size > 2 * 1024 * 1024) return undefined;
  try {
    const value = JSON.parse(await platform.fileSystem.readText(path)) as ArtifactMetadata;
    if (value.schemaVersion !== 1 || normalizeEventKey(value.appId) !== id || !value.versions || typeof value.versions !== 'object' || Array.isArray(value.versions)) return undefined;
    for (const [version, entry] of Object.entries(value.versions)) {
      if (!/^[a-f0-9]{64}$/.test(version) || !entry || !Array.isArray(entry.files) || entry.files.length > 513 ||
        entry.files.some(file => typeof file !== 'string' || !/^files\/[a-f0-9]{64}\.(html|blob)$/.test(file)) ||
        entry.complete !== undefined && entry.complete !== true) return undefined;
    }
    if (value.icon && (!/^[a-f0-9]{64}$/.test(value.icon.sourceHash) ||
      value.icon.path !== `files/${value.icon.sourceHash}.blob` || !/^[a-f0-9]{64}$/.test(value.icon.manifestId))) return undefined;
    return { ...value, appId: id };
  } catch { return undefined; }
}

export async function recordArtifactIcon(source: ArtifactSource, hash: string) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('invalid-hash');
  const version = manifestId(source);
  const { id, directory } = await applicationDirectory(source);
  await platform.fileSystem.updateJson(`${directory}/metadata.json`, {
    schemaVersion: 1, appId: id, versions: {},
    icon: { path: `files/${hash}.blob`, sourceHash: hash, manifestId: version },
  });
}

async function readCachedArtifact(path: string, hash: string, maxBytes: number, signal?: AbortSignal) {
  const stat = await platform.fileSystem.stat(path);
  if (!stat.exists || stat.size != null && stat.size > maxBytes) return undefined;
  const bytes = await platform.fileSystem.readBytes(path);
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  assertNotAborted(signal);
  if (bytes.length <= maxBytes && await platform.deviceCrypto.sha256Hex(bytes) === hash) return bytes;
  return undefined;
}

async function cachedArtifact(paths: { path: string; legacy: string[] }, hash: string, maxBytes: number, signal?: AbortSignal) {
  const current = await readCachedArtifact(paths.path, hash, maxBytes, signal);
  if (current) return current;
  for (const path of paths.legacy) {
    const legacy = await readCachedArtifact(path, hash, maxBytes, signal);
    if (!legacy) continue;
    assertNotAborted(signal);
    await platform.fileSystem.writeBytes(paths.path, legacy);
    return legacy;
  }
  return undefined;
}
export async function fetchBlob(
  release: Pick<NappletRelease, 'servers'>,
  hash: string,
  maxBytes: number,
  signal?: AbortSignal,
  onProgress?: (progress: ArtifactProgress) => void,
): Promise<Uint8Array> {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('invalid-hash');
  let lastError: unknown;
  for (const server of release.servers) {
    assertNotAborted(signal);
    try {
      onProgress?.({ received: 0, phase: 'downloading' });
      const bytes = await platform.napplet.fetchResource(
        publicUrl(`${server.replace(/\/$/, '')}/${hash}`),
        maxBytes,
        signal,
        onProgress ? { onProgress: progress => onProgress({ ...progress, phase: 'downloading' }) } : undefined,
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      assertNotAborted(signal);
      onProgress?.({ received: bytes.length, total: bytes.length, phase: 'verifying' });
      if (bytes.length > maxBytes) throw new Error('too-large');
      if ((await platform.deviceCrypto.sha256Hex(bytes)) !== hash)
        throw new Error('hash-mismatch');
      return bytes;
    } catch (error) {
      assertNotAborted(signal);
      if (error instanceof Error && error.message === 'applications.rebuild_required') throw error;
      lastError = error;
    }
  }
  throw new Error('applications.download_failed', { cause: lastError });
}
export async function loadArtifact(release: NappletRelease, signal?: AbortSignal, onDownload?: () => void, onProgress?: (progress: ArtifactProgress) => void): Promise<string> {
  assertNotAborted(signal);
  const paths = await artifactPaths(release, release.hash, 'html');
  const cached = await cachedArtifact(paths, release.hash, MAX_ARTIFACT_BYTES, signal);
  if (cached) {
    const html = await decodeNappletHtml(cached, signal);
    await recordArtifactVersion(release, [`files/${release.hash}.html`], true);
    return html;
  }
  assertNotAborted(signal);
  await recordArtifactVersion(release, [`files/${release.hash}.html`], false);
  onDownload?.();
  const bytes = await fetchBlob(release, release.hash, MAX_ARTIFACT_BYTES, signal, onProgress).catch((error) => {
    assertNotAborted(signal);
    console.warn(
      '[napplet] Artifact download failed',
      release.hash,
      error instanceof Error ? (error.cause ?? error) : error,
    );
    throw error;
  });
  const html = await decodeNappletHtml(bytes, signal);
  assertNotAborted(signal);
  await platform.fileSystem.writeBytes(paths.path, bytes);
  await recordArtifactVersion(release, [`files/${release.hash}.html`], true);
  return html;
}
const icons = new Map<string, Promise<string | undefined>>();
const iconJobs: (() => void)[] = [];
let activeIcons = 0;
function nextIcon() {
  if (activeIcons < 4) iconJobs.shift()?.();
}
export function loadIcon(release: ArtifactSource & Pick<NappletRelease, 'icon'>): Promise<string | undefined> {
  if (!release.icon) return Promise.resolve(undefined);
  const { hash, mime } = release.icon;
  const key = `${applicationId(release)}:${hash}`;
  const cached = icons.get(key);
  if (cached) return cached;
  if (icons.size > 256) icons.delete(icons.keys().next().value!);
  if (iconJobs.length >= 64) return Promise.resolve(undefined);
  const pending = new Promise<string | undefined>((resolve) => {
    iconJobs.push(() => {
      activeIcons++;
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), 8000);
      void loadSiteBlob(release, hash, timeout.signal, 512 * 1024)
        .then(async (bytes) => {
          if (resourceMime(bytes) !== mime) return undefined;
          await recordArtifactIcon(release, hash);
          return `data:${mime};base64,${base64.encode(bytes)}`;
        })
        .catch(() => undefined)
        .then(resolve)
        .finally(() => {
          clearTimeout(timer);
          activeIcons--;
          nextIcon();
        });
    });
    nextIcon();
  });
  void pending.then((value) => {
    if (!value && icons.get(key) === pending) icons.delete(key);
  });
  icons.set(key, pending);
  return pending;
}

/** Immutable assets are scoped by application identity and shared across accounts. */
export async function loadSiteBlob(release: ArtifactSource, hash: string, signal?: AbortSignal, maxBytes = MAX_ARTIFACT_BYTES, onProgress?: (progress: ArtifactProgress) => void): Promise<Uint8Array> {
  assertNotAborted(signal);
  const paths = await artifactPaths(release, hash, 'blob');
  const cached = await cachedArtifact(paths, hash, maxBytes, signal);
  if (cached) return cached;
  const bytes = await fetchBlob(release, hash, maxBytes, signal, onProgress);
  assertNotAborted(signal);
  await platform.fileSystem.writeBytes(paths.path, bytes);
  return bytes;
}
