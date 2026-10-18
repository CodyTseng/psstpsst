import { decodeNappletHtml } from '@/platform/napplet-bytes';
import { assertNotAborted } from '@/platform/abort';
import { base64 } from '@scure/base';
import { platform } from '@/platform';
import { MAX_ARTIFACT_BYTES, publicUrl, resourceMime, type NappletRelease } from './protocol';

async function artifactPath(hash: string): Promise<string> {
  const root = await platform.fileSystem.documentDirectoryUri();
  if (!root) throw new Error('storage-unavailable');
  const directory = `${root.replace(/\/$/, '')}/napplets`;
  await platform.fileSystem.makeDirectory(directory, { intermediates: true, idempotent: true });
  return `${directory}/${hash}.html`;
}
export async function fetchBlob(
  release: Pick<NappletRelease, 'servers'>,
  hash: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('invalid-hash');
  let lastError: unknown;
  for (const server of release.servers) {
    assertNotAborted(signal);
    try {
      const bytes = await platform.napplet.fetchResource(
        publicUrl(`${server.replace(/\/$/, '')}/${hash}`),
        maxBytes,
        signal,
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (bytes.length > maxBytes) throw new Error('too-large');
      if ((await platform.deviceCrypto.sha256Hex(bytes)) !== hash)
        throw new Error('hash-mismatch');
      return bytes;
    } catch (error) {
      assertNotAborted(signal);
      if (error instanceof Error && error.message === 'napplets.rebuild_required') throw error;
      lastError = error;
    }
  }
  throw new Error('napplets.download_failed', { cause: lastError });
}
export async function loadArtifact(release: NappletRelease, signal?: AbortSignal, onDownload?: () => void): Promise<string> {
  const path = await artifactPath(release.hash);
  if ((await platform.fileSystem.stat(path)).exists) {
    const bytes = await platform.fileSystem.readBytes(path);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (
      bytes.length <= MAX_ARTIFACT_BYTES &&
      (await platform.deviceCrypto.sha256Hex(bytes)) === release.hash
    )
      return await decodeNappletHtml(bytes, signal);
  }
  assertNotAborted(signal);
  onDownload?.();
  const bytes = await fetchBlob(release, release.hash, MAX_ARTIFACT_BYTES, signal).catch((error) => {
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
  await platform.fileSystem.writeBytes(path, bytes);
  return html;
}
const icons = new Map<string, Promise<string | undefined>>();
const iconJobs: (() => void)[] = [];
let activeIcons = 0;
function nextIcon() {
  if (activeIcons < 4) iconJobs.shift()?.();
}
export function loadIcon(release: Pick<NappletRelease, 'icon' | 'servers'>): Promise<string | undefined> {
  if (!release.icon) return Promise.resolve(undefined);
  const { hash, mime } = release.icon;
  const cached = icons.get(hash);
  if (cached) return cached;
  if (icons.size > 256) icons.delete(icons.keys().next().value!);
  if (iconJobs.length >= 64) return Promise.resolve(undefined);
  const pending = new Promise<string | undefined>((resolve) => {
    iconJobs.push(() => {
      activeIcons++;
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), 8000);
      void fetchBlob(release, hash, 512 * 1024, timeout.signal)
        .then((bytes) => {
          if (resourceMime(bytes) !== mime) return undefined;
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
    if (!value && icons.get(hash) === pending) icons.delete(hash);
  });
  icons.set(hash, pending);
  return pending;
}

/** Immutable site assets share the existing verified artifact cache across accounts. */
export async function loadSiteBlob(release: Pick<NappletRelease, 'servers'>, hash: string, signal?: AbortSignal): Promise<Uint8Array> {
  const path=(await artifactPath(hash)).replace(/\.html$/,'.blob');
  if((await platform.fileSystem.stat(path)).exists) {
    const bytes=await platform.fileSystem.readBytes(path);
    await new Promise<void>(resolve=>setTimeout(resolve,0));
    assertNotAborted(signal);
    if(bytes.length<=MAX_ARTIFACT_BYTES && await platform.deviceCrypto.sha256Hex(bytes)===hash) return bytes;
  }
  const bytes=await fetchBlob(release,hash,MAX_ARTIFACT_BYTES,signal);
  assertNotAborted(signal);await platform.fileSystem.writeBytes(path,bytes);return bytes;
}
