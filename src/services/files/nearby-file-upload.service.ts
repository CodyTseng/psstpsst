import { and, asc, eq, inArray, lt } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  proximityFilePartials,
  proximityFileSpools,
  proximityFileUploads,
  storedFiles,
} from '@/db/schema';
import {
  blossomDownloadUrls,
  buildBlossomUri,
  parseBlossomUri,
} from '@/lib/nostr/blossom-uri';
import { normalizeBlossomUrl } from '@/lib/nostr/blossom-url';
import { hexToBytes } from '@/lib/nostr/keys';
import { platform } from '@/platform';
import { getProximityEventSigner } from '@/services/proximity/proximity-identity.service';
import { nearbyPartialUri } from '@/services/proximity/proximity-file-transfer.service';
import type { NearbyFileOffer } from '@/services/proximity/proximity-file-offer';

import { attachmentName, attachmentPath } from './attachment-store';
import { uploadEncryptedBlobToServer } from './blossom.service';
import { sha256Hex } from './file-crypto';

const SPOOL_DIR = 'psstpsst-nearby-spool';
const RETRY_SECONDS = [15, 30, 60, 120, 300] as const;
const WAIT_FOR_UPLOAD_MS = 60_000;
const PREFERRED_UPLOAD_WAIT_MS = 15_000;
const PARTIAL_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

type RemoteAvailableListener = (value: { accountPubkey: string; x: string }) => void;
type UploadProgressListener = (sentBytes: number, totalBytes: number) => void;

async function spoolDir(): Promise<string> {
  const root = await platform.fileSystem.documentDirectoryUri();
  if (!root) throw new Error('Persistent storage is unavailable');
  const dir = `${root}${SPOOL_DIR}/`;
  await platform.fileSystem.makeDirectory(dir, { intermediates: true, idempotent: true });
  return dir;
}

export async function nearbySpoolUri(localName: string): Promise<string> {
  if (!/^[0-9a-f]{64}-[0-9a-f]{64}\.bin$/.test(localName)) {
    throw new Error('Invalid Nearby spool name');
  }
  return `${await spoolDir()}${localName}`;
}

export async function stageNearbyUpload(opts: {
  accountPubkey: string;
  x: string;
  ox: string;
  cipher: Uint8Array;
  plainSize: number;
  keyHex: string;
  nonceHex: string;
  mime: string;
  servers: readonly string[];
}): Promise<{ url: string; localName: string }> {
  const servers = Array.from(new Set(opts.servers.map(normalizeBlossomUrl)));
  const url = buildBlossomUri(opts.x, servers);
  const localName = `${opts.accountPubkey}-${opts.x}.bin`;
  const uri = await nearbySpoolUri(localName);
  await platform.fileSystem.writeBytes(uri, opts.cipher);
  const now = Math.floor(Date.now() / 1000);
  try {
    await db.transaction(async (tx) => {
      await tx
        .insert(proximityFileSpools)
        .values({
          accountPubkey: opts.accountPubkey,
          x: opts.x,
          ox: opts.ox,
          localName,
          cipherSize: opts.cipher.length,
          plainSize: opts.plainSize,
          keyHex: opts.keyHex,
          nonceHex: opts.nonceHex,
          mime: opts.mime,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: [proximityFileSpools.accountPubkey, proximityFileSpools.x],
          set: { localName },
        });
      await tx
        .insert(proximityFileUploads)
        .values(
          servers.map((server) => ({
            accountPubkey: opts.accountPubkey,
            x: opts.x,
            server,
            status: 'queued' as const,
            attempts: 0,
            nextAttemptAt: now,
          })),
        )
        .onConflictDoNothing();
    });
  } catch (error) {
    await platform.fileSystem.delete(uri, { idempotent: true }).catch(() => {});
    throw error;
  }
  nearbyFileUploadService.wake(opts.accountPubkey);
  return { url, localName };
}

async function reconstructSpool(row: typeof proximityFileSpools.$inferSelect): Promise<string> {
  const uri = await nearbySpoolUri(row.localName);
  const stat = await platform.fileSystem.stat(uri);
  if (stat.exists && stat.size === row.cipherSize) return uri;

  const stored = await db
    .select({ mime: storedFiles.mime, size: storedFiles.size })
    .from(storedFiles)
    .where(eq(storedFiles.ox, row.ox))
    .limit(1)
    .get();
  if (!stored || stored.size !== row.plainSize) throw new Error('Nearby plaintext is unavailable');
  const plainUri = await attachmentPath(attachmentName(row.ox, stored.mime));
  const plain = await platform.fileSystem.readBytes(plainUri);
  if (plain.length !== row.plainSize || (await sha256Hex(plain)) !== row.ox) {
    throw new Error('Nearby plaintext integrity check failed');
  }
  const cipher = await platform.deviceCrypto.aesGcmSeal(
    plain,
    hexToBytes(row.keyHex),
    hexToBytes(row.nonceHex),
    new Uint8Array(),
  );
  if (cipher.length !== row.cipherSize || (await sha256Hex(cipher)) !== row.x) {
    throw new Error('Reconstructed Nearby ciphertext does not match its manifest');
  }
  await platform.fileSystem.writeBytes(uri, cipher);
  return uri;
}

class NearbyFileUploadService {
  private accounts = new Set<string>();
  private running = false;
  private requested = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<RemoteAvailableListener>();
  private waiters = new Map<string, Set<() => void>>();
  private progress = new Map<string, { sentBytes: number; totalBytes: number }>();
  private progressListeners = new Map<string, Set<UploadProgressListener>>();
  private uploadControllers = new Map<string, AbortController>();
  private paused = new Set<string>();
  private discarded = new Set<string>();
  private listeningToNetwork = false;

  start(accountPubkey: string): void {
    this.accounts.add(accountPubkey);
    if (!this.listeningToNetwork) {
      this.listeningToNetwork = true;
      platform.networkState.addStateListener((state) => {
        if (state.isConnected !== false && state.isInternetReachable !== false) this.wake();
      });
    }
    void cleanupExpiredNearbyPartials(accountPubkey);
    void db
      .update(proximityFileUploads)
      .set({ status: 'queued' })
      .where(
        and(
          eq(proximityFileUploads.accountPubkey, accountPubkey),
          eq(proximityFileUploads.status, 'uploading'),
        ),
      )
      .then(() => this.wake(accountPubkey));
  }

  stop(accountPubkey: string): void {
    this.accounts.delete(accountPubkey);
  }

  addRemoteAvailableListener(listener: RemoteAvailableListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private uploadKey(accountPubkey: string, x: string): string {
    return `${accountPubkey}:${x}`;
  }

  private reportProgress(
    accountPubkey: string,
    x: string,
    sentBytes: number,
    totalBytes: number,
  ): void {
    const key = this.uploadKey(accountPubkey, x);
    const value = { sentBytes, totalBytes };
    this.progress.set(key, value);
    for (const listener of this.progressListeners.get(key) ?? []) {
      listener(sentBytes, totalBytes);
    }
  }

  private addProgressListener(
    accountPubkey: string,
    x: string,
    listener: UploadProgressListener,
  ): () => void {
    const key = this.uploadKey(accountPubkey, x);
    const listeners = this.progressListeners.get(key) ?? new Set<UploadProgressListener>();
    listeners.add(listener);
    this.progressListeners.set(key, listeners);
    const current = this.progress.get(key);
    if (current) listener(current.sentBytes, current.totalBytes);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.progressListeners.delete(key);
    };
  }

  async pause(accountPubkey: string, x: string): Promise<void> {
    const key = this.uploadKey(accountPubkey, x);
    this.paused.add(key);
    this.progress.delete(key);
    this.uploadControllers.get(key)?.abort();
    await db
      .update(proximityFileUploads)
      .set({ status: 'paused', nextAttemptAt: null })
      .where(
        and(
          eq(proximityFileUploads.accountPubkey, accountPubkey),
          eq(proximityFileUploads.x, x),
          inArray(proximityFileUploads.status, ['queued', 'uploading']),
        ),
      );
  }

  async resume(accountPubkey: string, x: string): Promise<void> {
    const key = this.uploadKey(accountPubkey, x);
    this.paused.delete(key);
    await db
      .update(proximityFileUploads)
      .set({ status: 'queued', nextAttemptAt: Math.floor(Date.now() / 1000) })
      .where(
        and(
          eq(proximityFileUploads.accountPubkey, accountPubkey),
          eq(proximityFileUploads.x, x),
          eq(proximityFileUploads.status, 'paused'),
        ),
      );
    this.wake(accountPubkey);
  }

  async discard(accountPubkey: string, x: string): Promise<void> {
    const key = this.uploadKey(accountPubkey, x);
    this.paused.add(key);
    this.discarded.add(key);
    const active = this.uploadControllers.has(key);
    this.uploadControllers.get(key)?.abort();
    const spool = await db
      .select({ localName: proximityFileSpools.localName })
      .from(proximityFileSpools)
      .where(
        and(
          eq(proximityFileSpools.accountPubkey, accountPubkey),
          eq(proximityFileSpools.x, x),
        ),
      )
      .limit(1)
      .get();
    await db.transaction(async (tx) => {
      await tx
        .delete(proximityFileUploads)
        .where(
          and(
            eq(proximityFileUploads.accountPubkey, accountPubkey),
            eq(proximityFileUploads.x, x),
          ),
        );
      await tx
        .delete(proximityFileSpools)
        .where(
          and(
            eq(proximityFileSpools.accountPubkey, accountPubkey),
            eq(proximityFileSpools.x, x),
          ),
        );
    });
    if (spool) {
      await platform.fileSystem
        .delete(await nearbySpoolUri(spool.localName), { idempotent: true })
        .catch(() => {});
    }
    this.progress.delete(key);
    if (!active) {
      this.paused.delete(key);
      this.discarded.delete(key);
    }
  }

  wake(accountPubkey?: string): void {
    if (accountPubkey) this.accounts.add(accountPubkey);
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.running) {
      this.requested = true;
      return;
    }
    void this.drain();
  }

  async waitUntilAvailable(
    accountPubkey: string,
    x: string,
    signal?: AbortSignal,
    timeoutMs = WAIT_FOR_UPLOAD_MS,
  ): Promise<void> {
    const uploaded = await db
      .select({ server: proximityFileUploads.server })
      .from(proximityFileUploads)
      .where(
        and(
          eq(proximityFileUploads.accountPubkey, accountPubkey),
          eq(proximityFileUploads.x, x),
          eq(proximityFileUploads.status, 'uploaded'),
        ),
      )
      .limit(1)
      .get();
    if (uploaded) return;
    const key = `${accountPubkey}:${x}`;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        const group = this.waiters.get(key);
        group?.delete(onAvailable);
        if (group?.size === 0) this.waiters.delete(key);
        if (error) reject(error);
        else resolve();
      };
      const onAvailable = () => finish();
      const onAbort = () => {
        const error = new Error('Upload cancelled');
        error.name = 'AbortError';
        finish(error);
      };
      const timer = setTimeout(
        () => finish(new Error('Nearby attachment upload is still unavailable')),
        timeoutMs,
      );
      const group = this.waiters.get(key) ?? new Set();
      group.add(onAvailable);
      this.waiters.set(key, group);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
      this.wake(accountPubkey);
    });
  }

  async preferUntilAvailable(
    accountPubkey: string,
    x: string,
    signal?: AbortSignal,
    onProgress?: UploadProgressListener,
  ): Promise<boolean> {
    const removeProgress = onProgress
      ? this.addProgressListener(accountPubkey, x, onProgress)
      : undefined;
    await this.resume(accountPubkey, x);
    try {
      const network = await platform.networkState.getState().catch(() => undefined);
      if (network?.isConnected === false || network?.isInternetReachable === false) return false;
      await this.waitUntilAvailable(accountPubkey, x, signal, PREFERRED_UPLOAD_WAIT_MS);
      return true;
    } catch {
      return false;
    } finally {
      removeProgress?.();
    }
  }

  private announce(accountPubkey: string, x: string): void {
    const key = `${accountPubkey}:${x}`;
    for (const resolve of this.waiters.get(key) ?? []) resolve();
    for (const listener of this.listeners) listener({ accountPubkey, x });
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      do {
        this.requested = false;
        const now = Math.floor(Date.now() / 1000);
        let nextAt: number | null = null;
        for (const accountPubkey of this.accounts) {
          const rows = await db
            .select()
            .from(proximityFileUploads)
            .where(
              and(
                eq(proximityFileUploads.accountPubkey, accountPubkey),
                inArray(proximityFileUploads.status, ['queued', 'uploading']),
              ),
            )
            .orderBy(asc(proximityFileUploads.nextAttemptAt));
          for (const row of rows) {
            if (row.nextAttemptAt != null && row.nextAttemptAt > now) {
              nextAt = nextAt == null ? row.nextAttemptAt : Math.min(nextAt, row.nextAttemptAt);
              continue;
            }
            await this.upload(row);
          }
        }
        if (nextAt != null && !this.timer) {
          this.timer = setTimeout(() => {
            this.timer = null;
            this.wake();
          }, Math.max(0, nextAt * 1000 - Date.now()));
        }
      } while (this.requested);
    } finally {
      this.running = false;
    }
  }

  private async upload(row: typeof proximityFileUploads.$inferSelect): Promise<void> {
    const uploadKey = this.uploadKey(row.accountPubkey, row.x);
    if (this.paused.has(uploadKey)) return;
    const controller = new AbortController();
    this.uploadControllers.set(uploadKey, controller);
    const spool = await db
      .select()
      .from(proximityFileSpools)
      .where(
        and(
          eq(proximityFileSpools.accountPubkey, row.accountPubkey),
          eq(proximityFileSpools.x, row.x),
        ),
      )
      .limit(1)
      .get()
      .catch((error) => {
        if (this.uploadControllers.get(uploadKey) === controller) {
          this.uploadControllers.delete(uploadKey);
        }
        throw error;
      });
    if (!spool) {
      if (this.uploadControllers.get(uploadKey) === controller) {
        this.uploadControllers.delete(uploadKey);
      }
      if (this.discarded.has(uploadKey)) {
        this.discarded.delete(uploadKey);
        this.paused.delete(uploadKey);
      }
      return;
    }
    const attempts = row.attempts + 1;
    try {
      await db
        .update(proximityFileUploads)
        .set({ status: 'uploading', attempts })
        .where(
          and(
            eq(proximityFileUploads.accountPubkey, row.accountPubkey),
            eq(proximityFileUploads.x, row.x),
            eq(proximityFileUploads.server, row.server),
          ),
        );
      const fileUri = await reconstructSpool(spool);
      await uploadEncryptedBlobToServer({
        signer: await getProximityEventSigner(row.accountPubkey),
        cipherFileUri: fileUri,
        cipherSha256Hex: row.x,
        sizeBytes: spool.cipherSize,
        server: row.server,
        signal: controller.signal,
        onProgress: (sentBytes, totalBytes) =>
          this.reportProgress(row.accountPubkey, row.x, sentBytes, totalBytes),
      });
      this.reportProgress(row.accountPubkey, row.x, spool.cipherSize, spool.cipherSize);
      const now = Math.floor(Date.now() / 1000);
      await db
        .update(proximityFileUploads)
        .set({ status: 'uploaded', nextAttemptAt: null, lastError: null, uploadedAt: now })
        .where(
          and(
            eq(proximityFileUploads.accountPubkey, row.accountPubkey),
            eq(proximityFileUploads.x, row.x),
            eq(proximityFileUploads.server, row.server),
          ),
        );
      this.announce(row.accountPubkey, row.x);
      const remaining = await db
        .select({ server: proximityFileUploads.server })
        .from(proximityFileUploads)
        .where(
          and(
            eq(proximityFileUploads.accountPubkey, row.accountPubkey),
            eq(proximityFileUploads.x, row.x),
            inArray(proximityFileUploads.status, ['queued', 'uploading']),
          ),
        )
        .limit(1)
        .get();
      if (!remaining) {
        await platform.fileSystem
          .delete(await nearbySpoolUri(spool.localName), { idempotent: true })
          .catch(() => {});
        await db
          .delete(proximityFileSpools)
          .where(
            and(
              eq(proximityFileSpools.accountPubkey, row.accountPubkey),
              eq(proximityFileSpools.x, row.x),
            ),
          );
      }
    } catch (error) {
      if (this.paused.has(uploadKey)) {
        await db
          .update(proximityFileUploads)
          .set({ status: 'paused', nextAttemptAt: null, lastError: null })
          .where(
            and(
              eq(proximityFileUploads.accountPubkey, row.accountPubkey),
              eq(proximityFileUploads.x, row.x),
              eq(proximityFileUploads.server, row.server),
            ),
          );
        return;
      }
      const delay = RETRY_SECONDS[Math.min(attempts - 1, RETRY_SECONDS.length - 1)];
      this.reportProgress(row.accountPubkey, row.x, 0, spool.cipherSize);
      await db
        .update(proximityFileUploads)
        .set({
          status: 'queued',
          nextAttemptAt: Math.floor(Date.now() / 1000) + delay,
          lastError: error instanceof Error ? error.message : String(error),
        })
        .where(
          and(
            eq(proximityFileUploads.accountPubkey, row.accountPubkey),
            eq(proximityFileUploads.x, row.x),
            eq(proximityFileUploads.server, row.server),
          ),
        );
      this.requested = true;
    } finally {
      if (this.uploadControllers.get(uploadKey) === controller) {
        this.uploadControllers.delete(uploadKey);
      }
      if (this.discarded.has(uploadKey)) {
        await platform.fileSystem
          .delete(await nearbySpoolUri(spool.localName), { idempotent: true })
          .catch(() => {});
        this.discarded.delete(uploadKey);
        this.paused.delete(uploadKey);
      }
    }
  }
}

export const nearbyFileUploadService = new NearbyFileUploadService();

async function cleanupExpiredNearbyPartials(accountPubkey: string): Promise<void> {
  const cutoff = Date.now() - PARTIAL_EXPIRY_MS;
  const rows = await db
    .select({ localName: proximityFilePartials.localName })
    .from(proximityFilePartials)
    .where(
      and(
        eq(proximityFilePartials.accountPubkey, accountPubkey),
        lt(proximityFilePartials.lastProgressAt, cutoff),
      ),
    );
  await Promise.all(
    rows.map(async (row) =>
      platform.fileSystem
        .delete(await nearbyPartialUri(row.localName), { idempotent: true })
        .catch(() => {}),
    ),
  );
  await db
    .delete(proximityFilePartials)
    .where(
      and(
        eq(proximityFilePartials.accountPubkey, accountPubkey),
        lt(proximityFilePartials.lastProgressAt, cutoff),
      ),
    );
}

/** Ensure an immutable Nearby manifest has a queued spool and at least one uploaded copy. */
export async function ensureNearbyFileRemotelyAvailable(
  accountPubkey: string,
  offer: NearbyFileOffer,
  signal?: AbortSignal,
  waitForUpload = true,
): Promise<void> {
  const uploaded = await db
    .select({ server: proximityFileUploads.server })
    .from(proximityFileUploads)
    .where(
      and(
        eq(proximityFileUploads.accountPubkey, accountPubkey),
        eq(proximityFileUploads.x, offer.cipherSha256Hex),
        eq(proximityFileUploads.status, 'uploaded'),
      ),
    )
    .limit(1)
    .get();
  if (uploaded) return;

  const spool = await db
    .select({ x: proximityFileSpools.x })
    .from(proximityFileSpools)
    .where(
      and(
        eq(proximityFileSpools.accountPubkey, accountPubkey),
        eq(proximityFileSpools.x, offer.cipherSha256Hex),
      ),
    )
    .limit(1)
    .get();
  if (spool) {
    if (waitForUpload) {
      await nearbyFileUploadService.waitUntilAvailable(
        accountPubkey,
        offer.cipherSha256Hex,
        signal,
      );
    }
    return;
  }

  const manifest = parseBlossomUri(offer.url);
  if (!manifest || manifest.servers.length === 0) throw new Error('Invalid Nearby manifest');
  for (const url of blossomDownloadUrls(manifest)) {
    if (signal?.aborted) {
      const error = new Error('Upload cancelled');
      error.name = 'AbortError';
      throw error;
    }
    try {
      let response = await platform.fileSystem.requestRemoteFile(url, {
        method: 'HEAD',
        readBody: false,
        signal,
      });
      let available =
        response.status >= 200 &&
        response.status < 300 &&
        Number(response.headers['content-length']) === offer.size;
      if (!available && response.status !== 404) {
        response = await platform.fileSystem.requestRemoteFile(url, {
          method: 'GET',
          headers: { Range: 'bytes=0-0' },
          readBody: false,
          signal,
        });
        const contentRange = response.headers['content-range']?.match(/^bytes 0-0\/(\d+)$/);
        available =
          (response.status === 206 && Number(contentRange?.[1]) === offer.size) ||
          (response.status === 200 &&
            Number(response.headers['content-length']) === offer.size);
      }
      if (available) return;
    } catch {
      if (signal?.aborted) {
        const error = new Error('Upload cancelled');
        error.name = 'AbortError';
        throw error;
      }
    }
  }

  const stored = await db
    .select({ mime: storedFiles.mime, size: storedFiles.size })
    .from(storedFiles)
    .where(eq(storedFiles.ox, offer.plainSha256Hex))
    .limit(1)
    .get();
  if (!stored || stored.size !== offer.plainSize) {
    throw new Error('Forwarded Nearby attachment is not available locally');
  }
  const plain = await platform.fileSystem.readBytes(
    await attachmentPath(attachmentName(offer.plainSha256Hex, stored.mime)),
  );
  if (plain.length !== offer.plainSize || (await sha256Hex(plain)) !== offer.plainSha256Hex) {
    throw new Error('Forwarded Nearby attachment failed its plaintext integrity check');
  }
  const cipher = await platform.deviceCrypto.aesGcmSeal(
    plain,
    hexToBytes(offer.decryptionKeyHex),
    hexToBytes(offer.decryptionNonceHex),
    new Uint8Array(),
  );
  if (cipher.length !== offer.size || (await sha256Hex(cipher)) !== offer.cipherSha256Hex) {
    throw new Error('Forwarded Nearby attachment failed ciphertext reconstruction');
  }
  await stageNearbyUpload({
    accountPubkey,
    x: offer.cipherSha256Hex,
    ox: offer.plainSha256Hex,
    cipher,
    plainSize: offer.plainSize,
    keyHex: offer.decryptionKeyHex,
    nonceHex: offer.decryptionNonceHex,
    mime: offer.mime,
    servers: manifest.servers,
  });
  if (waitForUpload) {
    await nearbyFileUploadService.waitUntilAvailable(
      accountPubkey,
      offer.cipherSha256Hex,
      signal,
    );
  }
}

/** Remove every durable Nearby file job and partial owned by an account. */
export async function deleteAccountNearbyFileData(accountPubkey: string): Promise<void> {
  const [spools, partials] = await Promise.all([
    db
      .select({ localName: proximityFileSpools.localName })
      .from(proximityFileSpools)
      .where(eq(proximityFileSpools.accountPubkey, accountPubkey)),
    db
      .select({ localName: proximityFilePartials.localName })
      .from(proximityFilePartials)
      .where(eq(proximityFilePartials.accountPubkey, accountPubkey)),
  ]);
  await Promise.all([
    ...spools.map(async (row) =>
      platform.fileSystem
        .delete(await nearbySpoolUri(row.localName), { idempotent: true })
        .catch(() => {}),
    ),
    ...partials.map(async (row) =>
      platform.fileSystem
        .delete(await nearbyPartialUri(row.localName), { idempotent: true })
        .catch(() => {}),
    ),
  ]);
  await db.transaction(async (tx) => {
    await tx
      .delete(proximityFileUploads)
      .where(eq(proximityFileUploads.accountPubkey, accountPubkey));
    await tx
      .delete(proximityFileSpools)
      .where(eq(proximityFileSpools.accountPubkey, accountPubkey));
    await tx
      .delete(proximityFilePartials)
      .where(eq(proximityFilePartials.accountPubkey, accountPubkey));
  });
  nearbyFileUploadService.stop(accountPubkey);
}
