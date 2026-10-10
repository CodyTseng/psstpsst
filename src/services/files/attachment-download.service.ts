import { throwIfAborted } from '@/lib/async/abort';
import { platform } from '@/platform';

import { sha256Hex } from './file-crypto';

const CHUNK_BYTES = 512 * 1024;
const pending = new Map<string, Promise<void>>();

type PartialInfo = { total: number; validator?: string; complete?: boolean };

export type DownloadedAttachment = { bytes: Uint8Array; discard(): Promise<void> };

class MissingDownloadCacheError extends Error {}

type DownloadOptions = {
  url: string;
  identity: string;
  expectedSize?: number;
  immutable: boolean;
  signal?: AbortSignal;
  onProgress?: (receivedBytes: number, totalBytes: number) => void;
};

/** A cache disappearing between filesystem operations is recoverable once. */
export async function downloadAttachmentBytes(opts: DownloadOptions): Promise<DownloadedAttachment> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await downloadAttachmentBytesAttempt(opts);
    } catch (error) {
      throwIfAborted(opts.signal);
      if (!(error instanceof MissingDownloadCacheError) || attempt > 0) throw error;
    }
  }
}

async function serializeCache<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = pending.get(key);
  let release!: () => void;
  const lock = new Promise<void>((resolve) => { release = resolve; });
  const queued = (previous ?? Promise.resolve()).then(() => lock);
  pending.set(key, queued);
  try {
    await previous;
    return await operation();
  } finally {
    release();
    if (pending.get(key) === queued) pending.delete(key);
  }
}

/** Persist completed ranges; serialize readers and deletion of the shared cache. */
async function downloadAttachmentBytesAttempt(opts: DownloadOptions): Promise<DownloadedAttachment> {
  const key = await sha256Hex(new TextEncoder().encode(`${opts.identity}:${opts.url}`));
  return serializeCache(key, async () => {
    throwIfAborted(opts.signal);
    const directory = await platform.fileSystem.cacheDirectoryUri();
    if (!directory) throw new Error('Attachment download cache is unavailable');
    const uri = `${directory}attachment-download-${key}.part`;
    const infoUri = `${uri}.json`;
    let info: PartialInfo | null = null;
    try {
      info = JSON.parse(await platform.fileSystem.readText(infoUri));
    } catch { /* A missing sidecar starts a fresh download. */ }
    const stat = await platform.fileSystem.stat(uri);
    let offset = stat.exists ? stat.size ?? 0 : 0;
    let total = info?.total ?? opts.expectedSize ?? 0;
    if (!Number.isSafeInteger(total) || total < 0) total = 0;
    if (
      !info || !Number.isSafeInteger(total) || total <= 0 || offset > total ||
      (!opts.immutable && !info.validator && !info.complete)
    ) offset = 0;
    const remove = async () => {
      await platform.fileSystem.delete(uri, { idempotent: true });
      await platform.fileSystem.delete(infoUri, { idempotent: true });
    };
    const cacheOperation = async <T>(operation: () => Promise<T>): Promise<T> => {
      try { return await operation(); }
      catch (error) {
        throwIfAborted(opts.signal);
        if (!(await platform.fileSystem.stat(uri)).exists) throw new MissingDownloadCacheError('Attachment cache disappeared');
        throw error;
      }
    };
    opts.onProgress?.(offset, total);
    let writer = await cacheOperation(() => platform.fileSystem.openWriteHandle(uri, { offset, truncate: offset === 0 }));
    try {
      while (!total || offset < total) {
        throwIfAborted(opts.signal);
        const start = offset;
        const end = total ? Math.min(total - 1, offset + CHUNK_BYTES - 1) : offset + CHUNK_BYTES - 1;
        const headers: Record<string, string> =
          !opts.immutable && info && !info.validator ? {} : { Range: `bytes=${start}-${end}` };
        if (start && info?.validator) headers['If-Range'] = info.validator;
        const response = await platform.fileSystem.requestRemoteFile(opts.url, {
          method: 'GET', headers, signal: opts.signal,
          onProgress: (received, responseTotal) => opts.onProgress?.(received, responseTotal || total),
        });
        throwIfAborted(opts.signal);
        if (response.status !== 200 && response.status !== 206) {
          throw new Error(`Download failed ${response.status} for ${opts.url}`);
        }
        const bytes = response.body;
        if (response.status === 206) {
          const range = response.headers['content-range']?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
          const actualTotal = range ? Number(range[3]) : 0;
          if (
            !range || Number(range[1]) !== start || Number(range[2]) !== start + bytes.length - 1 ||
            bytes.length === 0 || bytes.length > CHUNK_BYTES || actualTotal <= start ||
            start + bytes.length > actualTotal || (start > 0 && actualTotal !== total)
          ) {
            await platform.fileSystem.delete(infoUri, { idempotent: true });
            throw new Error('Invalid attachment range response');
          }
          total = actualTotal;
        } else {
          if (start) {
            await writer.close();
            writer = await platform.fileSystem.openWriteHandle(uri, { truncate: true });
          }
          offset = 0;
          total = bytes.length;
        }
        info = {
          total,
          complete: offset + bytes.length === total,
          validator: response.headers.etag?.startsWith('W/')
            ? response.headers['last-modified']
            : response.headers.etag ?? response.headers['last-modified'],
        };
        await writer.writeBytes(bytes);
        offset += bytes.length;
        await platform.fileSystem.writeText(infoUri, JSON.stringify(info));
        opts.onProgress?.(offset, total);
        if (response.status === 200) break;
      }
    } finally {
      await writer.close();
    }
    throwIfAborted(opts.signal);
    await platform.fileSystem.writeText(infoUri, JSON.stringify({ ...info, total, complete: true }));
    const bytes = await cacheOperation(() => platform.fileSystem.readBytes(uri));
    throwIfAborted(opts.signal);
    return { bytes, discard: () => serializeCache(key, remove) };
  });
}
