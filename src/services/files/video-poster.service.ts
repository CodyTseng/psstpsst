import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

import { platform } from '@/platform';
import type { VideoThumbnailMetadata } from '@/platform/ports/video-thumbnail';
import { validMediaDimensions } from '@/lib/attachments/media-dim';
import { computeThumbhash } from '@/lib/image/thumbhash';

const MAX_MEMORY_ENTRIES = 128;
const MAX_CONCURRENT_DECODES = 2;
const FAILURE_RETRY_MS = 30_000;
const memory = new Map<string, { metadata?: VideoThumbnailMetadata; expires: number }>();
type PosterJob = {
  promise: Promise<VideoThumbnailMetadata | undefined>;
  consumers: (AbortSignal | undefined)[];
};
const inFlight = new Map<string, PosterJob>();
const hashJobs = new Map<string, Promise<string | undefined>>();
const waiting: (() => void)[] = [];
let active = 0;

async function queued<T>(task: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT_DECODES) await new Promise<void>((resolve) => waiting.push(resolve));
  else active++;
  try {
    return await task();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}

function remember(uri: string, metadata?: VideoThumbnailMetadata): void {
  memory.delete(uri);
  memory.set(uri, { metadata, expires: metadata?.posterUri ? Infinity : Date.now() + FAILURE_RETRY_MS });
  if (memory.size > MAX_MEMORY_ENTRIES) memory.delete(memory.keys().next().value!);
}

async function cachePaths(uri: string): Promise<{ poster: string; metadata: string }> {
  const root = `${await platform.fileSystem.cacheDirectoryUri()}video-posters/`;
  await platform.fileSystem.makeDirectory(root, { intermediates: true, idempotent: true });
  const key = bytesToHex(sha256(utf8ToBytes(uri)));
  return { poster: `${root}${key}.jpg`, metadata: `${root}${key}.json` };
}

async function persist(path: string, metadata: VideoThumbnailMetadata): Promise<void> {
  const staging = `${path}.partial`;
  try {
    await platform.fileSystem.writeBytes(staging, utf8ToBytes(JSON.stringify(metadata)));
    await platform.fileSystem.delete(path, { idempotent: true });
    await platform.fileSystem.move(staging, path);
  } finally {
    await platform.fileSystem.delete(staging, { idempotent: true }).catch(() => {});
  }
}

async function resolveMetadata(uri: string): Promise<VideoThumbnailMetadata | undefined> {
  const paths = await cachePaths(uri);
  try {
    if ((await platform.fileSystem.stat(paths.poster)).exists) {
      const saved = JSON.parse(new TextDecoder().decode(await platform.fileSystem.readBytes(paths.metadata)));
      if (validMediaDimensions(saved)) return { ...saved, posterUri: paths.poster };
    }
  } catch {
    // Evicted or interrupted caches are regenerated from the local source.
  }
  const stagingPoster = `${paths.poster}.partial`;
  await platform.fileSystem.delete(stagingPoster, { idempotent: true });
  const generated = await platform.videoThumbnail.generateMetadata(uri, {
    includeThumbhash: false,
    posterUri: stagingPoster,
  });
  if (!generated || !validMediaDimensions(generated)) return undefined;
  const metadata = { ...generated };
  if (metadata.posterUri) {
    try {
      // Expo move does not overwrite. Replace only after a complete new image exists.
      await platform.fileSystem.delete(paths.poster, { idempotent: true });
      await platform.fileSystem.move(metadata.posterUri, paths.poster);
      metadata.posterUri = paths.poster;
      await persist(paths.metadata, metadata).catch(() => {});
    } catch {
      await platform.fileSystem.delete(metadata.posterUri, { idempotent: true }).catch(() => {});
      metadata.posterUri = undefined;
    }
  }
  return metadata;
}

/** Local immutable sources only: no download, bounded decoding, persistent small posters. */
export async function getVideoMetadata(
  uri: string,
  options?: { includeThumbhash?: boolean; signal?: AbortSignal },
): Promise<VideoThumbnailMetadata | undefined> {
  if (options?.signal?.aborted) return undefined;
  if (!/^(?:file|content|blob|psstpsst-file|ph|assets-library):/.test(uri)) return undefined;
  let metadata: VideoThumbnailMetadata | undefined;
  const cached = memory.get(uri);
  if (cached && cached.expires > Date.now() &&
    (!cached.metadata?.posterUri || (await platform.fileSystem.stat(cached.metadata.posterUri)).exists)) {
    metadata = cached.metadata;
    memory.delete(uri);
    memory.set(uri, cached);
  } else {
    let job = inFlight.get(uri);
    if (!job) {
      const consumers = [options?.signal];
      let abandoned = false;
      const promise = queued(() => {
        abandoned = consumers.every((signal) => signal?.aborted);
        return abandoned ? Promise.resolve(undefined) : resolveMetadata(uri);
      }).catch(() => undefined).then((result) => {
        if (!abandoned) remember(uri, result);
        return result;
      }).finally(() => inFlight.delete(uri));
      job = { promise, consumers };
      inFlight.set(uri, job);
    } else job.consumers.push(options?.signal);
    metadata = await job.promise;
  }
  if (!metadata || options?.includeThumbhash === false || metadata.thumbhash) return metadata;
  if (!metadata.posterUri) return metadata;
  let hashJob = hashJobs.get(uri);
  if (!hashJob) {
    const poster = metadata.posterUri;
    hashJob = queued(() => computeThumbhash(poster, metadata!.width, metadata!.height))
      .finally(() => hashJobs.delete(uri));
    hashJobs.set(uri, hashJob);
  }
  const thumbhash = await hashJob;
  const result = { ...metadata, thumbhash };
  remember(uri, result);
  if (thumbhash) await persist((await cachePaths(uri)).metadata, result).catch(() => {});
  return result;
}

/** Carry the staged-source poster into the content-addressed mirror without decoding again. */
export async function copyVideoPoster(sourceUri: string, targetUri: string): Promise<void> {
  try {
    const metadata = memory.get(sourceUri)?.metadata ?? await inFlight.get(sourceUri)?.promise;
    if (!metadata?.posterUri) return;
    const paths = await cachePaths(targetUri);
    await platform.fileSystem.copy(metadata.posterUri, paths.poster, { overwrite: true });
    const copied = { ...metadata, posterUri: paths.poster };
    await persist(paths.metadata, copied);
    remember(targetUri, copied);
  } catch {
    // Posters are optional cache data; attachment storage remains authoritative.
  }
}
