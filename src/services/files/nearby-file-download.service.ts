import { and, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { proximityFilePartials } from '@/db/schema';
import { blossomDownloadUrls, parseBlossomUri } from '@/lib/nostr/blossom-uri';
import { platform } from '@/platform';
import {
  nearbyPartialUri,
  removeNearbyFilePartial,
  removeNearbyFilePartials,
} from '@/services/proximity/proximity-file-transfer.service';
import type { NearbyFileOffer } from '@/services/proximity/proximity-file-offer';

import { markDownloaded } from './attachment-index.service';
import { attachmentName, attachmentPath, ensureAttachmentDir, sniffMime } from './attachment-store';
import { decryptBytes, sha256Hex } from './file-crypto';

const RANGE_CHUNK_BYTES = 512 * 1024;
const DISK_RESERVE_BYTES = 1024 * 1024;
const REMOTE_ANNOUNCEMENT_WAIT_MS = 15_000;

const remoteWaiters = new Map<string, Set<() => void>>();

export function notifyNearbyRemoteAvailable(
  accountPubkey: string,
  rumorId: string,
  x: string,
): void {
  const key = `${accountPubkey}:${rumorId}:${x}`;
  for (const resolve of remoteWaiters.get(key) ?? []) resolve();
}

async function waitForRemoteAnnouncement(
  accountPubkey: string,
  rumorId: string,
  x: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const key = `${accountPubkey}:${rumorId}:${x}`;
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (available: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      const group = remoteWaiters.get(key);
      group?.delete(announced);
      if (group?.size === 0) remoteWaiters.delete(key);
      resolve(available);
    };
    const announced = () => finish(true);
    const abort = () => finish(false);
    const timer = setTimeout(() => finish(false), REMOTE_ANNOUNCEMENT_WAIT_MS);
    const group = remoteWaiters.get(key) ?? new Set();
    group.add(announced);
    remoteWaiters.set(key, group);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

export class NearbyRemoteIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NearbyRemoteIntegrityError';
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('Download cancelled');
  error.name = 'AbortError';
  throw error;
}

async function prepareCipherPartial(opts: {
  accountPubkey: string;
  peerPubkey: string;
  rumorId: string;
  offer: NearbyFileOffer;
}): Promise<{ uri: string; offset: number }> {
  const localName = `${opts.accountPubkey}-${opts.rumorId}-cipher.part`;
  const uri = await nearbyPartialUri(localName);
  const row = await db
    .select()
    .from(proximityFilePartials)
    .where(
      and(
        eq(proximityFilePartials.accountPubkey, opts.accountPubkey),
        eq(proximityFilePartials.rumorId, opts.rumorId),
        eq(proximityFilePartials.representation, 'cipher'),
      ),
    )
    .limit(1)
    .get();
  const stat = await platform.fileSystem.stat(uri);
  const reusable =
    row?.peerPubkey === opts.peerPubkey &&
    row.x === opts.offer.cipherSha256Hex &&
    row.ox === opts.offer.plainSha256Hex &&
    row.expectedSize === opts.offer.size &&
    stat.exists &&
    stat.size === row.offset;
  const offset = reusable ? row.offset : 0;
  if (!reusable) await platform.fileSystem.delete(uri, { idempotent: true }).catch(() => {});
  if ((await platform.fileSystem.availableDiskSpace()) < opts.offer.size - offset + DISK_RESERVE_BYTES) {
    throw new Error('Insufficient storage for attachment');
  }
  await db
    .insert(proximityFilePartials)
    .values({
      accountPubkey: opts.accountPubkey,
      rumorId: opts.rumorId,
      representation: 'cipher',
      peerPubkey: opts.peerPubkey,
      x: opts.offer.cipherSha256Hex,
      ox: opts.offer.plainSha256Hex,
      expectedSize: opts.offer.size,
      offset,
      localName,
      mime: opts.offer.mime,
      url: opts.offer.url,
      lastProgressAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: [
        proximityFilePartials.accountPubkey,
        proximityFilePartials.rumorId,
        proximityFilePartials.representation,
      ],
      set: {
        peerPubkey: opts.peerPubkey,
        x: opts.offer.cipherSha256Hex,
        ox: opts.offer.plainSha256Hex,
        expectedSize: opts.offer.size,
        offset,
        localName,
        mime: opts.offer.mime,
        url: opts.offer.url,
        lastProgressAt: Date.now(),
      },
    });
  return { uri, offset };
}

async function persistOffset(accountPubkey: string, rumorId: string, offset: number): Promise<void> {
  await db
    .update(proximityFilePartials)
    .set({ offset, lastProgressAt: Date.now() })
    .where(
      and(
        eq(proximityFilePartials.accountPubkey, accountPubkey),
        eq(proximityFilePartials.rumorId, rumorId),
        eq(proximityFilePartials.representation, 'cipher'),
      ),
    );
}

/** Resume ciphertext ranges from `xs`, then verify, decrypt, and commit the plaintext. */
export async function fetchNearbyAttachmentFromBlossom(opts: {
  accountPubkey: string;
  peerPubkey: string;
  rumorId: string;
  offer: NearbyFileOffer;
  signal?: AbortSignal;
  waitForAnnouncement?: boolean;
  onProgress?: (receivedBytes: number, totalBytes: number) => void;
}): Promise<string> {
  throwIfAborted(opts.signal);
  const network = await platform.networkState.getState().catch(() => undefined);
  if (network?.isConnected === false || network?.isInternetReachable === false) {
    throw new Error('Internet access is unavailable');
  }
  const manifest = parseBlossomUri(opts.offer.url);
  if (!manifest || manifest.sha256 !== opts.offer.cipherSha256Hex) {
    throw new Error('Invalid Nearby Blossom manifest');
  }
  const candidates = blossomDownloadUrls(manifest);
  if (candidates.length === 0) throw new Error('No media server is available');
  const partial = await prepareCipherPartial(opts);
  let offset = partial.offset;
  opts.onProgress?.(offset, opts.offer.size);
  let lastError: unknown;
  let onlyTemporaryMissing = true;

  for (const url of candidates) {
    let writer = await platform.fileSystem.openWriteHandle(partial.uri, {
      offset,
      truncate: offset === 0,
    });
    try {
      while (offset < opts.offer.size) {
        throwIfAborted(opts.signal);
        const end = Math.min(opts.offer.size - 1, offset + RANGE_CHUNK_BYTES - 1);
        const response = await platform.fileSystem.requestRemoteFile(url, {
          method: 'GET',
          headers: { Range: `bytes=${offset}-${end}` },
          signal: opts.signal,
        });
        if (response.status === 404) throw new Error(`Attachment is not uploaded to ${url}`);
        if (response.status !== 200 && response.status !== 206) {
          throw new Error(`Download failed ${response.status} for ${url}`);
        }
        const range =
          response.status === 206
            ? response.headers['content-range']?.match(/^bytes (\d+)-(\d+)\/(\d+|\*)$/)
            : null;
        if (
          response.status === 206 &&
          (!range || Number(range[1]) !== offset || Number(range[3]) !== opts.offer.size)
        ) {
          throw new Error('Invalid range response');
        } else if (response.status === 200 && offset !== 0) {
          await writer.close();
          offset = 0;
          writer = await platform.fileSystem.openWriteHandle(partial.uri, { truncate: true });
        }
        const bytes = response.body;
        if (bytes.length === 0 || offset + bytes.length > opts.offer.size) {
          throw new Error('Invalid attachment response length');
        }
        if (
          (response.status === 200 && bytes.length !== opts.offer.size) ||
          (range && Number(range[2]) !== offset + bytes.length - 1)
        ) {
          throw new Error('Invalid attachment response length');
        }
        await writer.writeBytes(bytes);
        offset += bytes.length;
        await persistOffset(opts.accountPubkey, opts.rumorId, offset);
        opts.onProgress?.(offset, opts.offer.size);
      }
      await writer.close();
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      if (!(error instanceof Error) || !error.message.startsWith('Attachment is not uploaded')) {
        onlyTemporaryMissing = false;
      }
      await writer.close().catch(() => {});
      throwIfAborted(opts.signal);
    }
  }
  if (lastError) {
    if (
      onlyTemporaryMissing &&
      opts.waitForAnnouncement !== false &&
      (await waitForRemoteAnnouncement(
        opts.accountPubkey,
        opts.rumorId,
        opts.offer.cipherSha256Hex,
        opts.signal,
      ))
    ) {
      return fetchNearbyAttachmentFromBlossom({ ...opts, waitForAnnouncement: false });
    }
    throw lastError;
  }

  const cipher = await platform.fileSystem.readBytes(partial.uri);
  if (cipher.length !== opts.offer.size || (await sha256Hex(cipher)) !== opts.offer.cipherSha256Hex) {
    await removeNearbyFilePartial(opts.accountPubkey, opts.rumorId, 'cipher');
    throw new NearbyRemoteIntegrityError('ciphertext hash mismatch');
  }
  let plain: Uint8Array;
  try {
    plain = await decryptBytes({
      cipher,
      keyHex: opts.offer.decryptionKeyHex,
      nonceHex: opts.offer.decryptionNonceHex,
    });
  } catch {
    await removeNearbyFilePartial(opts.accountPubkey, opts.rumorId, 'cipher');
    throw new NearbyRemoteIntegrityError('attachment decryption failed');
  }
  if (
    plain.length !== opts.offer.plainSize ||
    (await sha256Hex(plain)) !== opts.offer.plainSha256Hex
  ) {
    await removeNearbyFilePartial(opts.accountPubkey, opts.rumorId, 'cipher');
    throw new NearbyRemoteIntegrityError('plaintext hash mismatch');
  }
  const mime = sniffMime(plain) ?? opts.offer.mime;
  await ensureAttachmentDir();
  const target = await attachmentPath(attachmentName(opts.offer.plainSha256Hex, mime));
  const commit = await attachmentPath(
    `${opts.offer.plainSha256Hex}-${opts.rumorId}.incoming`,
  );
  await platform.fileSystem.delete(commit, { idempotent: true }).catch(() => {});
  try {
    await platform.fileSystem.writeBytes(commit, plain);
    if (!(await platform.fileSystem.stat(target)).exists) {
      try {
        await platform.fileSystem.move(commit, target);
      } catch (error) {
        if (!(await platform.fileSystem.stat(target)).exists) throw error;
      }
    }
  } finally {
    await platform.fileSystem.delete(commit, { idempotent: true }).catch(() => {});
  }
  await markDownloaded(opts.offer.url, opts.offer.plainSha256Hex, mime, plain.length);
  await removeNearbyFilePartials(opts.accountPubkey, opts.rumorId);
  return target;
}
