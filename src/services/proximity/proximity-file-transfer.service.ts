import { and, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  conversations,
  messages,
  proximityFilePartials,
  storedFiles,
} from '@/db/schema';
import { platform } from '@/platform';
import { markDownloaded, resolveDownloaded } from '@/services/files/attachment-index.service';
import {
  attachmentName,
  attachmentPath,
  ensureAttachmentDir,
  resolveAttachmentPath,
  sniffMime,
} from '@/services/files/attachment-store';
import { sha256Hex } from '@/services/files/file-crypto';

import {
  ProximityFileCancelReason,
  ProximityFileCompleteStatus,
  ProximityPacketType,
  bytesToHex,
  decodeFileAccept,
  decodeFileCancel,
  decodeFileChunk,
  decodeFileComplete,
  decodeFileProgress,
  decodeFileRequest,
  encodeFileAccept,
  encodeFileCancel,
  encodeFileChunk,
  encodeFileComplete,
  encodeFileProgress,
  encodeFileRequest,
  hexToBytes,
  type ProximityFileAccept,
  type ProximityFileRequest,
} from './proximity-protocol';
import { parseNearbyFileOffer, type NearbyFileOffer } from './proximity-file-offer';

const PARTIAL_DIR = 'psstpsst-nearby-partials';
const DEFAULT_CHUNK_SIZE = 16 * 1024;
const DEFAULT_WINDOW = 1;
const TRANSFER_TIMEOUT_MS = 15_000;
const DISK_RESERVE_BYTES = 1024 * 1024;
const MAX_GLOBAL_TRANSFERS = 2;

export type ProximityFileConnection = {
  id: string;
  accountPubkey: string;
  localPubkey: string;
  peerPubkey: string;
  send(type: ProximityPacketType, payload: Uint8Array): Promise<void>;
};

export class ProximityFileTransferError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly reason: ProximityFileCancelReason,
  ) {
    super(message);
    this.name = 'ProximityFileTransferError';
  }
}

type IncomingTransfer = {
  key: string;
  transferId: Uint8Array;
  connection: ProximityFileConnection;
  rumorId: string;
  offer: NearbyFileOffer;
  partialUri: string;
  offset: number;
  chunkSize: number;
  windowChunks: number;
  accepted: boolean;
  acceptedOffset?: number;
  writer?: Awaited<ReturnType<typeof platform.fileSystem.openWriteHandle>>;
  timer?: ReturnType<typeof setTimeout>;
  resolve(uri: string): void;
  reject(error: Error): void;
  onProgress?(receivedBytes: number, totalBytes: number): void;
};

type OutgoingTransfer = {
  key: string;
  transferId: Uint8Array;
  connection: ProximityFileConnection;
  request: ProximityFileRequest;
  offer: NearbyFileOffer;
  fileUri: string;
  reader: Awaited<ReturnType<typeof platform.fileSystem.openReadHandle>>;
  acceptedOffset: number;
  chunkSize: number;
  windowChunks: number;
  sentThrough: number;
  acknowledgedThrough: number;
  inFlightEnds: number[];
  pumping: boolean;
  timer?: ReturnType<typeof setTimeout>;
};

async function partialDir(): Promise<string> {
  const root = await platform.fileSystem.documentDirectoryUri();
  if (!root) throw new Error('Persistent storage is unavailable');
  const dir = `${root}${PARTIAL_DIR}/`;
  await platform.fileSystem.makeDirectory(dir, { intermediates: true, idempotent: true });
  return dir;
}

export async function nearbyPartialUri(localName: string): Promise<string> {
  if (!/^[0-9a-f]{64}-[0-9a-f]{64}-(plain|cipher)\.part$/.test(localName)) {
    throw new Error('Invalid Nearby partial name');
  }
  return `${await partialDir()}${localName}`;
}

export async function removeNearbyFilePartial(
  accountPubkey: string,
  rumorId: string,
  representation: 'plain' | 'cipher',
): Promise<void> {
  const row = await db
    .select({ localName: proximityFilePartials.localName })
    .from(proximityFilePartials)
    .where(
      and(
        eq(proximityFilePartials.accountPubkey, accountPubkey),
        eq(proximityFilePartials.rumorId, rumorId),
        eq(proximityFilePartials.representation, representation),
      ),
    )
    .limit(1)
    .get();
  if (row) {
    await platform.fileSystem
      .delete(await nearbyPartialUri(row.localName), { idempotent: true })
      .catch(() => {});
  }
  await db
    .delete(proximityFilePartials)
    .where(
      and(
        eq(proximityFilePartials.accountPubkey, accountPubkey),
        eq(proximityFilePartials.rumorId, rumorId),
        eq(proximityFilePartials.representation, representation),
      ),
    );
}

export async function removeNearbyFilePartials(
  accountPubkey: string,
  rumorId: string,
): Promise<void> {
  await Promise.all([
    removeNearbyFilePartial(accountPubkey, rumorId, 'plain'),
    removeNearbyFilePartial(accountPubkey, rumorId, 'cipher'),
  ]);
}

async function randomTransferId(): Promise<Uint8Array> {
  return hexToBytes((await platform.deviceCrypto.randomUUID()).replaceAll('-', ''));
}

function transferKey(connectionId: string, transferId: Uint8Array): string {
  return `${connectionId}:${bytesToHex(transferId)}`;
}

function cancellationError(reason: ProximityFileCancelReason, retryable: boolean): Error {
  return new ProximityFileTransferError(`Nearby file transfer stopped (${reason})`, retryable, reason);
}

class ProximityFileTransferService {
  private incoming = new Map<string, IncomingTransfer>();
  private outgoing = new Map<string, OutgoingTransfer>();
  private activeIncomingPeers = new Set<string>();
  private activeOutgoingPeers = new Set<string>();

  async fetchDirect(opts: {
    connection: ProximityFileConnection;
    rumorId: string;
    offer: NearbyFileOffer;
    signal?: AbortSignal;
    onProgress?: (receivedBytes: number, totalBytes: number) => void;
  }): Promise<string> {
    const cached = await resolveDownloaded(opts.offer);
    if (cached) {
      const path = await resolveAttachmentPath(attachmentName(cached.ox, cached.mime));
      if (path) return path;
    }
    if (
      this.activeIncomingPeers.has(opts.connection.peerPubkey) ||
      this.incoming.size + this.outgoing.size >= MAX_GLOBAL_TRANSFERS
    ) {
      throw cancellationError(ProximityFileCancelReason.Busy, true);
    }

    const partial = await this.preparePlainPartial(opts);
    opts.onProgress?.(partial.offset, opts.offer.plainSize);
    const transferId = await randomTransferId();
    const key = transferKey(opts.connection.id, transferId);
    return new Promise<string>((resolve, reject) => {
      const transfer: IncomingTransfer = {
        key,
        transferId,
        connection: opts.connection,
        rumorId: opts.rumorId,
        offer: opts.offer,
        partialUri: partial.uri,
        offset: partial.offset,
        chunkSize: DEFAULT_CHUNK_SIZE,
        windowChunks: DEFAULT_WINDOW,
        accepted: false,
        resolve,
        reject,
        onProgress: opts.onProgress,
      };
      this.incoming.set(key, transfer);
      this.activeIncomingPeers.add(opts.connection.peerPubkey);
      const abort = () => {
        void this.cancelIncoming(
          transfer,
          ProximityFileCancelReason.UserCancelled,
          false,
          true,
        );
      };
      opts.signal?.addEventListener('abort', abort, { once: true });
      const finish = () => opts.signal?.removeEventListener('abort', abort);
      const originalResolve = transfer.resolve;
      const originalReject = transfer.reject;
      transfer.resolve = (uri) => {
        finish();
        originalResolve(uri);
      };
      transfer.reject = (error) => {
        finish();
        originalReject(error);
      };
      this.armIncomingTimeout(transfer);
      void opts.connection
        .send(
          ProximityPacketType.FileRequest,
          encodeFileRequest({
            transferId,
            rumorId: hexToBytes(opts.rumorId),
            ox: hexToBytes(opts.offer.plainSha256Hex),
            resumeOffset: partial.offset,
            desiredChunkSize: DEFAULT_CHUNK_SIZE,
            desiredWindow: DEFAULT_WINDOW,
          }),
        )
        .catch(() => this.failIncoming(transfer, cancellationError(ProximityFileCancelReason.Timeout, true)));
    });
  }

  async handleRecord(
    connection: ProximityFileConnection,
    type: ProximityPacketType,
    payload: Uint8Array,
  ): Promise<void> {
    switch (type) {
      case ProximityPacketType.FileRequest:
        await this.handleRequest(connection, decodeFileRequest(payload));
        return;
      case ProximityPacketType.FileAccept:
        await this.handleAccept(connection, decodeFileAccept(payload));
        return;
      case ProximityPacketType.FileChunk:
        await this.handleChunk(connection, decodeFileChunk(payload));
        return;
      case ProximityPacketType.FileProgress:
        await this.handleProgress(connection, decodeFileProgress(payload));
        return;
      case ProximityPacketType.FileComplete:
        await this.handleComplete(connection, decodeFileComplete(payload));
        return;
      case ProximityPacketType.FileCancel:
        await this.handleCancel(connection, decodeFileCancel(payload));
        return;
      default:
        throw new Error('Unsupported file transfer record');
    }
  }

  disconnect(connectionId: string): void {
    for (const transfer of Array.from(this.incoming.values())) {
      if (transfer.connection.id !== connectionId) continue;
      void this.failIncoming(
        transfer,
        cancellationError(ProximityFileCancelReason.Timeout, true),
      );
    }
    for (const transfer of Array.from(this.outgoing.values())) {
      if (transfer.connection.id !== connectionId) continue;
      void this.finishOutgoing(transfer);
    }
  }

  stop(): void {
    for (const transfer of Array.from(this.incoming.values())) {
      void this.failIncoming(
        transfer,
        cancellationError(ProximityFileCancelReason.Timeout, true),
      );
    }
    for (const transfer of Array.from(this.outgoing.values())) void this.finishOutgoing(transfer);
  }

  private async preparePlainPartial(opts: {
    connection: ProximityFileConnection;
    rumorId: string;
    offer: NearbyFileOffer;
  }): Promise<{ uri: string; offset: number }> {
    const localName = `${opts.connection.accountPubkey}-${opts.rumorId}-plain.part`;
    const uri = await nearbyPartialUri(localName);
    const row = await db
      .select()
      .from(proximityFilePartials)
      .where(
        and(
          eq(proximityFilePartials.accountPubkey, opts.connection.accountPubkey),
          eq(proximityFilePartials.rumorId, opts.rumorId),
          eq(proximityFilePartials.representation, 'plain'),
        ),
      )
      .limit(1)
      .get();
    const stat = await platform.fileSystem.stat(uri);
    const reusable =
      row?.peerPubkey === opts.connection.peerPubkey &&
      row.x === opts.offer.cipherSha256Hex &&
      row.ox === opts.offer.plainSha256Hex &&
      row.expectedSize === opts.offer.plainSize &&
      stat.exists &&
      stat.size === row.offset;
    const offset = reusable ? row.offset : 0;
    if (!reusable) await platform.fileSystem.delete(uri, { idempotent: true }).catch(() => {});
    const available = await platform.fileSystem.availableDiskSpace();
    if (available < opts.offer.plainSize - offset + DISK_RESERVE_BYTES) {
      throw cancellationError(ProximityFileCancelReason.InsufficientStorage, false);
    }
    await db
      .insert(proximityFilePartials)
      .values({
        accountPubkey: opts.connection.accountPubkey,
        rumorId: opts.rumorId,
        representation: 'plain',
        peerPubkey: opts.connection.peerPubkey,
        x: opts.offer.cipherSha256Hex,
        ox: opts.offer.plainSha256Hex,
        expectedSize: opts.offer.plainSize,
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
          peerPubkey: opts.connection.peerPubkey,
          x: opts.offer.cipherSha256Hex,
          ox: opts.offer.plainSha256Hex,
          expectedSize: opts.offer.plainSize,
          offset,
          localName,
          mime: opts.offer.mime,
          url: opts.offer.url,
          lastProgressAt: Date.now(),
        },
      });
    return { uri, offset };
  }

  private async handleRequest(
    connection: ProximityFileConnection,
    request: ProximityFileRequest,
  ): Promise<void> {
    const key = transferKey(connection.id, request.transferId);
    const existing = this.outgoing.get(key);
    if (existing) {
      const same =
        bytesToHex(existing.request.rumorId) === bytesToHex(request.rumorId) &&
        bytesToHex(existing.request.ox) === bytesToHex(request.ox) &&
        existing.request.resumeOffset === request.resumeOffset &&
        existing.request.desiredChunkSize === request.desiredChunkSize &&
        existing.request.desiredWindow === request.desiredWindow;
      if (!same) {
        await this.sendCancel(connection, request.transferId, ProximityFileCancelReason.InvalidRequest, false);
        return;
      }
      await connection.send(
        ProximityPacketType.FileAccept,
        encodeFileAccept(this.acceptance(existing)),
      );
      return;
    }
    if (
      this.activeOutgoingPeers.has(connection.peerPubkey) ||
      this.incoming.size + this.outgoing.size >= MAX_GLOBAL_TRANSFERS
    ) {
      await this.sendCancel(connection, request.transferId, ProximityFileCancelReason.Busy, true);
      return;
    }
    const authorized = await this.authorize(connection, request);
    if (!authorized) {
      await this.sendCancel(
        connection,
        request.transferId,
        ProximityFileCancelReason.NotAvailable,
        true,
      );
      return;
    }
    const acceptedOffset = request.resumeOffset <= authorized.offer.plainSize ? request.resumeOffset : 0;
    const chunkSize = Math.min(request.desiredChunkSize, DEFAULT_CHUNK_SIZE);
    const windowChunks = Math.min(request.desiredWindow, DEFAULT_WINDOW);
    const reader = await platform.fileSystem.openReadHandle(authorized.fileUri, {
      offset: acceptedOffset,
    });
    const transfer: OutgoingTransfer = {
      key,
      transferId: request.transferId.slice(),
      connection,
      request,
      offer: authorized.offer,
      fileUri: authorized.fileUri,
      reader,
      acceptedOffset,
      chunkSize,
      windowChunks,
      sentThrough: acceptedOffset,
      acknowledgedThrough: acceptedOffset,
      inFlightEnds: [],
      pumping: false,
    };
    this.outgoing.set(key, transfer);
    this.activeOutgoingPeers.add(connection.peerPubkey);
    this.armOutgoingTimeout(transfer);
    await connection.send(ProximityPacketType.FileAccept, encodeFileAccept(this.acceptance(transfer)));
    void this.pump(transfer);
  }

  private acceptance(transfer: OutgoingTransfer): ProximityFileAccept {
    return {
      transferId: transfer.transferId,
      ox: hexToBytes(transfer.offer.plainSha256Hex),
      plainSize: transfer.offer.plainSize,
      acceptedOffset: transfer.acceptedOffset,
      chunkSize: transfer.chunkSize,
      windowChunks: transfer.windowChunks,
    };
  }

  private async authorize(
    connection: ProximityFileConnection,
    request: ProximityFileRequest,
  ): Promise<{ offer: NearbyFileOffer; fileUri: string } | null> {
    const rumorId = bytesToHex(request.rumorId);
    const row = await db
      .select({ message: messages, conversation: conversations })
      .from(messages)
      .innerJoin(
        conversations,
        and(
          eq(conversations.accountPubkey, messages.accountPubkey),
          eq(conversations.conversationKey, messages.conversationKey),
        ),
      )
      .where(
        and(
          eq(messages.accountPubkey, connection.accountPubkey),
          eq(messages.id, rumorId),
          eq(messages.conversationKey, connection.peerPubkey),
        ),
      )
      .limit(1)
      .get();
    if (
      !row ||
      row.message.kind !== 15 ||
      row.message.senderPubkey !== connection.localPubkey ||
      row.conversation.deliveryKind !== 'proximity' ||
      row.conversation.proximityAccountPubkey !== connection.localPubkey ||
      row.conversation.deleted
    ) {
      return null;
    }
    const rumor = row.message.rumor;
    const recipients = rumor.tags.filter((tag) => tag[0] === 'p');
    const offer = parseNearbyFileOffer(rumor.content, rumor.tags);
    if (
      recipients.length !== 1 ||
      recipients[0][1] !== connection.peerPubkey ||
      !offer ||
      offer.plainSha256Hex !== bytesToHex(request.ox)
    ) {
      return null;
    }
    const stored = await db
      .select()
      .from(storedFiles)
      .where(eq(storedFiles.ox, offer.plainSha256Hex))
      .limit(1)
      .get();
    if (!stored || stored.size !== offer.plainSize) return null;
    const fileUri = await resolveAttachmentPath(attachmentName(stored.ox, stored.mime));
    if (!fileUri) return null;
    const stat = await platform.fileSystem.stat(fileUri);
    return stat.size === offer.plainSize ? { offer, fileUri } : null;
  }

  private async pump(transfer: OutgoingTransfer): Promise<void> {
    if (transfer.pumping || !this.outgoing.has(transfer.key)) return;
    transfer.pumping = true;
    try {
      while (
        this.outgoing.has(transfer.key) &&
        transfer.inFlightEnds.length < transfer.windowChunks &&
        transfer.sentThrough < transfer.offer.plainSize
      ) {
        const offset = transfer.sentThrough;
        const data = await transfer.reader.readBytes(
          Math.min(transfer.chunkSize, transfer.offer.plainSize - offset),
        );
        if (data.length === 0) throw new Error('Nearby source ended unexpectedly');
        await transfer.connection.send(
          ProximityPacketType.FileChunk,
          encodeFileChunk({ transferId: transfer.transferId, offset, data }),
        );
        transfer.sentThrough += data.length;
        transfer.inFlightEnds.push(transfer.sentThrough);
      }
    } catch {
      await this.sendCancel(
        transfer.connection,
        transfer.transferId,
        ProximityFileCancelReason.NotAvailable,
        true,
      );
      await this.finishOutgoing(transfer);
    } finally {
      transfer.pumping = false;
    }
  }

  private async handleAccept(
    connection: ProximityFileConnection,
    accepted: ProximityFileAccept,
  ): Promise<void> {
    const transfer = this.incoming.get(transferKey(connection.id, accepted.transferId));
    if (!transfer || transfer.connection.peerPubkey !== connection.peerPubkey) return;
    if (transfer.accepted) {
      if (
        bytesToHex(accepted.ox) === transfer.offer.plainSha256Hex &&
        accepted.plainSize === transfer.offer.plainSize &&
        accepted.acceptedOffset === transfer.acceptedOffset &&
        accepted.chunkSize === transfer.chunkSize &&
        accepted.windowChunks === transfer.windowChunks
      ) {
        return;
      }
      await this.cancelIncoming(
        transfer,
        ProximityFileCancelReason.InvalidRequest,
        false,
        true,
      );
      return;
    }
    if (
      bytesToHex(accepted.ox) !== transfer.offer.plainSha256Hex ||
      accepted.plainSize !== transfer.offer.plainSize ||
      (accepted.acceptedOffset !== transfer.offset && accepted.acceptedOffset !== 0) ||
      accepted.chunkSize > transfer.chunkSize ||
      accepted.windowChunks > transfer.windowChunks
    ) {
      await this.cancelIncoming(
        transfer,
        ProximityFileCancelReason.InvalidRequest,
        false,
        true,
      );
      return;
    }
    transfer.offset = accepted.acceptedOffset;
    transfer.acceptedOffset = accepted.acceptedOffset;
    transfer.chunkSize = accepted.chunkSize;
    transfer.windowChunks = accepted.windowChunks;
    transfer.writer = await platform.fileSystem.openWriteHandle(transfer.partialUri, {
      offset: transfer.offset,
      truncate: transfer.offset === 0,
    });
    transfer.accepted = true;
    await db
      .update(proximityFilePartials)
      .set({ offset: transfer.offset, lastProgressAt: Date.now() })
      .where(
        and(
          eq(proximityFilePartials.accountPubkey, connection.accountPubkey),
          eq(proximityFilePartials.rumorId, transfer.rumorId),
          eq(proximityFilePartials.representation, 'plain'),
        ),
      );
    this.armIncomingTimeout(transfer);
  }

  private async handleChunk(
    connection: ProximityFileConnection,
    chunk: { transferId: Uint8Array; offset: number; data: Uint8Array },
  ): Promise<void> {
    const transfer = this.incoming.get(transferKey(connection.id, chunk.transferId));
    if (!transfer || !transfer.accepted || !transfer.writer) return;
    if (
      chunk.offset !== transfer.offset ||
      chunk.data.length > transfer.chunkSize ||
      chunk.offset + chunk.data.length > transfer.offer.plainSize
    ) {
      await this.cancelIncoming(
        transfer,
        ProximityFileCancelReason.InvalidRequest,
        false,
        true,
      );
      return;
    }
    await transfer.writer.writeBytes(chunk.data);
    transfer.offset += chunk.data.length;
    await db
      .update(proximityFilePartials)
      .set({ offset: transfer.offset, lastProgressAt: Date.now() })
      .where(
        and(
          eq(proximityFilePartials.accountPubkey, connection.accountPubkey),
          eq(proximityFilePartials.rumorId, transfer.rumorId),
          eq(proximityFilePartials.representation, 'plain'),
        ),
      );
    transfer.onProgress?.(transfer.offset, transfer.offer.plainSize);
    await connection.send(
      ProximityPacketType.FileProgress,
      encodeFileProgress({ transferId: transfer.transferId, receivedThrough: transfer.offset }),
    );
    this.armIncomingTimeout(transfer);
    if (transfer.offset === transfer.offer.plainSize) await this.finalizeIncoming(transfer);
  }

  private async finalizeIncoming(transfer: IncomingTransfer): Promise<void> {
    await transfer.writer?.close();
    transfer.writer = undefined;
    const stat = await platform.fileSystem.stat(transfer.partialUri);
    if (stat.size !== transfer.offer.plainSize) {
      await this.cancelIncoming(
        transfer,
        ProximityFileCancelReason.IntegrityFailure,
        false,
        true,
      );
      return;
    }
    const plain = await platform.fileSystem.readBytes(transfer.partialUri);
    if ((await sha256Hex(plain)) !== transfer.offer.plainSha256Hex) {
      await this.cancelIncoming(
        transfer,
        ProximityFileCancelReason.IntegrityFailure,
        false,
        true,
      );
      return;
    }
    const mime = sniffMime(plain) ?? transfer.offer.mime;
    await ensureAttachmentDir();
    const target = await attachmentPath(attachmentName(transfer.offer.plainSha256Hex, mime));
    const targetStat = await platform.fileSystem.stat(target);
    let alreadyPresent = targetStat.exists;
    if (alreadyPresent) {
      await platform.fileSystem.delete(transfer.partialUri, { idempotent: true });
    } else {
      try {
        await platform.fileSystem.move(transfer.partialUri, target);
      } catch (error) {
        if (!(await platform.fileSystem.stat(target)).exists) throw error;
        alreadyPresent = true;
        await platform.fileSystem.delete(transfer.partialUri, { idempotent: true });
      }
    }
    await markDownloaded(
      transfer.offer.url,
      transfer.offer.plainSha256Hex,
      mime,
      transfer.offer.plainSize,
    );
    await db
      .delete(proximityFilePartials)
      .where(
        and(
          eq(proximityFilePartials.accountPubkey, transfer.connection.accountPubkey),
          eq(proximityFilePartials.rumorId, transfer.rumorId),
          eq(proximityFilePartials.representation, 'plain'),
        ),
      );
    await removeNearbyFilePartial(transfer.connection.accountPubkey, transfer.rumorId, 'cipher');
    await transfer.connection.send(
      ProximityPacketType.FileComplete,
      encodeFileComplete({
        transferId: transfer.transferId,
        ox: hexToBytes(transfer.offer.plainSha256Hex),
        plainSize: transfer.offer.plainSize,
        status: alreadyPresent
          ? ProximityFileCompleteStatus.AlreadyPresent
          : ProximityFileCompleteStatus.Stored,
      }),
    );
    this.removeIncoming(transfer);
    transfer.resolve(target);
  }

  private async handleProgress(
    connection: ProximityFileConnection,
    progress: { transferId: Uint8Array; receivedThrough: number },
  ): Promise<void> {
    const transfer = this.outgoing.get(transferKey(connection.id, progress.transferId));
    if (!transfer) return;
    if (
      progress.receivedThrough < transfer.acknowledgedThrough ||
      progress.receivedThrough > transfer.sentThrough
    ) {
      await this.sendCancel(
        connection,
        transfer.transferId,
        ProximityFileCancelReason.InvalidRequest,
        false,
      );
      await this.finishOutgoing(transfer);
      return;
    }
    transfer.acknowledgedThrough = progress.receivedThrough;
    transfer.inFlightEnds = transfer.inFlightEnds.filter(
      (ending) => ending > progress.receivedThrough,
    );
    this.armOutgoingTimeout(transfer);
    void this.pump(transfer);
  }

  private async handleComplete(
    connection: ProximityFileConnection,
    complete: {
      transferId: Uint8Array;
      ox: Uint8Array;
      plainSize: number;
      status: ProximityFileCompleteStatus;
    },
  ): Promise<void> {
    const transfer = this.outgoing.get(transferKey(connection.id, complete.transferId));
    if (!transfer) return;
    if (
      bytesToHex(complete.ox) !== transfer.offer.plainSha256Hex ||
      complete.plainSize !== transfer.offer.plainSize ||
      transfer.acknowledgedThrough !== transfer.offer.plainSize
    ) {
      await this.sendCancel(
        connection,
        transfer.transferId,
        ProximityFileCancelReason.InvalidRequest,
        false,
      );
    }
    await this.finishOutgoing(transfer);
  }

  private async handleCancel(
    connection: ProximityFileConnection,
    cancel: { transferId: Uint8Array; reason: ProximityFileCancelReason; retryable: boolean },
  ): Promise<void> {
    const key = transferKey(connection.id, cancel.transferId);
    const incoming = this.incoming.get(key);
    if (incoming) {
      await this.failIncoming(incoming, cancellationError(cancel.reason, cancel.retryable));
      return;
    }
    const outgoing = this.outgoing.get(key);
    if (outgoing) await this.finishOutgoing(outgoing);
  }

  private async sendCancel(
    connection: ProximityFileConnection,
    transferId: Uint8Array,
    reason: ProximityFileCancelReason,
    retryable: boolean,
  ): Promise<void> {
    await connection
      .send(
        ProximityPacketType.FileCancel,
        encodeFileCancel({ transferId, reason, retryable }),
      )
      .catch(() => {});
  }

  private armIncomingTimeout(transfer: IncomingTransfer): void {
    if (transfer.timer) clearTimeout(transfer.timer);
    transfer.timer = setTimeout(
      () =>
        void this.cancelIncoming(
          transfer,
          ProximityFileCancelReason.Timeout,
          true,
          false,
        ),
      TRANSFER_TIMEOUT_MS,
    );
  }

  private armOutgoingTimeout(transfer: OutgoingTransfer): void {
    if (transfer.timer) clearTimeout(transfer.timer);
    transfer.timer = setTimeout(async () => {
      await this.sendCancel(
        transfer.connection,
        transfer.transferId,
        ProximityFileCancelReason.Timeout,
        true,
      );
      await this.finishOutgoing(transfer);
    }, TRANSFER_TIMEOUT_MS);
  }

  private async cancelIncoming(
    transfer: IncomingTransfer,
    reason: ProximityFileCancelReason,
    retryable: boolean,
    removeFiles: boolean,
  ): Promise<void> {
    await this.sendCancel(transfer.connection, transfer.transferId, reason, retryable);
    await transfer.writer?.close().catch(() => {});
    transfer.writer = undefined;
    if (removeFiles) {
      if (reason === ProximityFileCancelReason.UserCancelled) {
        await removeNearbyFilePartials(transfer.connection.accountPubkey, transfer.rumorId);
      } else {
        await removeNearbyFilePartial(
          transfer.connection.accountPubkey,
          transfer.rumorId,
          'plain',
        );
      }
    }
    await this.failIncoming(transfer, cancellationError(reason, retryable));
  }

  private async failIncoming(transfer: IncomingTransfer, error: Error): Promise<void> {
    if (!this.incoming.has(transfer.key)) return;
    await transfer.writer?.close().catch(() => {});
    this.removeIncoming(transfer);
    transfer.reject(error);
  }

  private removeIncoming(transfer: IncomingTransfer): void {
    if (transfer.timer) clearTimeout(transfer.timer);
    this.incoming.delete(transfer.key);
    this.activeIncomingPeers.delete(transfer.connection.peerPubkey);
  }

  private async finishOutgoing(transfer: OutgoingTransfer): Promise<void> {
    if (!this.outgoing.has(transfer.key)) return;
    if (transfer.timer) clearTimeout(transfer.timer);
    this.outgoing.delete(transfer.key);
    this.activeOutgoingPeers.delete(transfer.connection.peerPubkey);
    await transfer.reader.close().catch(() => {});
  }
}

export const proximityFileTransferService = new ProximityFileTransferService();
