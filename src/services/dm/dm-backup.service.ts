import { bytesToHex } from '@noble/hashes/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { withStagedBackupFile } from './stage-backup-file';

import { platform } from '@/platform';
import type { FileWriteHandle } from '@/platform';
import type { Rumor } from '@/db/schema/types';
import {
  attachmentName,
  attachmentPath,
  ensureAttachmentDir,
  resolveAttachmentPath,
} from '@/services/files/attachment-store';
import { markImportedBatch } from '@/services/files/attachment-index.service';

import {
  BACKUP_CACHE_DIRECTORY_NAME,
  persistLatestAccountArchive,
  type BackupArchiveInfo,
} from './dm-backup-storage';
import {
  ARCHIVE_ATTACHMENTS,
  ARCHIVE_MANIFEST,
  ARCHIVE_MESSAGES,
  ARCHIVE_PROXIMITY_DIRECTORY,
  ARCHIVE_PROXIMITY_PEERS,
  archiveBlobPath,
  backupImportKind,
  createChatArchiveManifest,
  parseBackupRumor,
  parseChatArchiveAttachment,
  parseChatArchiveManifest,
  parseChatArchiveProximityPeer,
  type ChatArchiveAttachment,
  type ChatArchiveManifest,
  type ChatArchiveProximityPeer,
} from './dm-backup-format';
import { dmService } from './dm.service';
import { importProximityPeers } from '../proximity/proximity-peer.service';
import { proximityService } from '../proximity/proximity.service';

const IO_CHUNK_BYTES = 256 * 1024;
const HASH_CHUNK_BYTES = 1024 * 1024;
const MAX_LINE_CHARS = 16 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024;
const SMALL_JSON_BYTES = 16 * 1024 * 1024;
const IMPORT_BATCH = 100;
const URL_BATCH = 128;
const DISK_SAFETY_BYTES = 64 * 1024 * 1024;

export type BackupProgressPhase =
  | 'export_messages'
  | 'export_attachments'
  | 'create_archive'
  | 'open_archive'
  | 'scan_messages'
  | 'import_messages'
  | 'import_attachments';

export type BackupProgress = {
  phase: BackupProgressPhase;
  percent: number;
};

export type BackupExportResult = {
  messages: number;
  proximityPeers: number;
  attachments: number;
  attachmentBytes: number;
  omittedAttachments: number;
  archive: BackupArchiveInfo | null;
};

export type { BackupArchiveInfo } from './dm-backup-storage';

export type BackupImportResult = {
  source: 'archive' | 'messages';
  messages: {
    inserted: number;
    existing: number;
    invalid: number;
  };
  attachments: {
    restored: number;
    invalid: number;
  };
  proximityPeers: {
    restored: number;
    invalid: number;
  };
};

export type BackupErrorCode =
  | 'invalid_archive'
  | 'unsupported_file_type'
  | 'account_mismatch'
  | 'not_enough_space'
  | 'native_module_unavailable';

export class BackupError extends Error {
  readonly code: BackupErrorCode;

  constructor(code: BackupErrorCode, message: string) {
    super(message);
    this.name = 'BackupError';
    this.code = code;
  }
}

type ProgressCallback = (progress: BackupProgress) => void;

type PhaseProgress = {
  phase: BackupProgressPhase;
  completed: number;
  total: number | null;
};

type PhaseProgressCallback = (progress: PhaseProgress) => void;

type AttachmentRow = {
  ox: string;
  mime: string;
  url: string;
};

type AttachmentGroup = {
  ox: string;
  mime: string;
  urls: string[];
};

type MessageImportTotals = BackupImportResult['messages'];
type ProximityPeerImportTotals = BackupImportResult['proximityPeers'];

type MessageCounts = {
  messages: number;
};

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function emitPercent(
  onProgress: ProgressCallback | undefined,
  phase: BackupProgressPhase,
  percent: number,
): void {
  const safePercent = Number.isFinite(percent) ? percent : 0;
  onProgress?.({
    phase,
    percent: Math.max(0, Math.min(100, Math.round(safePercent))),
  });
}

function mapPhaseProgress(
  onProgress: ProgressCallback | undefined,
  startPercent: number,
  endPercent: number,
): PhaseProgressCallback {
  return ({ phase, completed, total }) => {
    const ratio = total && total > 0 ? completed / total : 1;
    emitPercent(onProgress, phase, startPercent + ratio * (endPercent - startPercent));
  };
}

function mapItemProgress(
  onProgress: ProgressCallback | undefined,
  startPercent: number,
  endPercent: number,
  totalItems: number,
  completedOffset: number,
): PhaseProgressCallback {
  return ({ phase, completed }) => {
    const ratio = totalItems > 0 ? (completedOffset + completed) / totalItems : 1;
    emitPercent(onProgress, phase, startPercent + ratio * (endPercent - startPercent));
  };
}

function nativePath(uri: string): string {
  return uri.startsWith('file://') ? decodeURIComponent(uri.slice('file://'.length)) : uri;
}

async function assertZipModuleAvailable(): Promise<void> {
  if (!(await platform.zipArchive.isAvailable())) {
    throw new BackupError(
      'native_module_unavailable',
      'The installed app build does not include the ZIP archive module',
    );
  }
}

async function createWorkDirectory(prefix: string): Promise<string> {
  const parent = `${await platform.fileSystem.cacheDirectoryUri()}${BACKUP_CACHE_DIRECTORY_NAME}/`;
  await platform.fileSystem.makeDirectory(parent, {
    idempotent: true,
    intermediates: true,
  });
  const work = `${parent}${prefix}-${await platform.deviceCrypto.randomUUID()}/`;
  await platform.fileSystem.makeDirectory(work);
  return work;
}

async function deleteDirectoryQuietly(directoryUri: string | null): Promise<void> {
  if (!directoryUri) return;
  const info = await platform.fileSystem.stat(directoryUri);
  if (!info.exists) return;
  try {
    await platform.fileSystem.delete(directoryUri);
  } catch {
    // Cache cleanup is best-effort.
  }
}

class NdjsonWriter {
  private pending: string[] = [];
  private pendingChars = 0;

  constructor(
    readonly fileUri: string,
    private readonly handle: FileWriteHandle,
  ) {}

  appendJson(value: unknown): Promise<void> {
    return this.appendLine(JSON.stringify(value));
  }

  async appendLine(value: string): Promise<void> {
    this.pending.push(value, '\n');
    this.pendingChars += value.length + 1;
    if (this.pendingChars >= IO_CHUNK_BYTES) await this.flush();
  }

  async flush(): Promise<void> {
    if (this.pendingChars === 0) return;
    await this.handle.writeBytes(new TextEncoder().encode(this.pending.join('')));
    this.pending = [];
    this.pendingChars = 0;
  }

  async close(): Promise<void> {
    await this.flush();
    await this.handle.close();
  }
}

async function createNdjsonWriter(fileUri: string): Promise<NdjsonWriter> {
  return new NdjsonWriter(fileUri, await platform.fileSystem.openWriteHandle(fileUri));
}

async function* readLines(
  fileUri: string,
  onReadProgress?: (completedBytes: number, totalBytes: number) => void,
): AsyncGenerator<string> {
  const handle = await platform.fileSystem.openReadHandle(fileUri);
  const decoder = new TextDecoder();
  const totalBytes = handle.size ?? 0;
  let pending = '';
  try {
    while ((handle.offset ?? 0) < (handle.size ?? 0)) {
      const remaining = (handle.size ?? 0) - (handle.offset ?? 0);
      const bytes = await handle.readBytes(Math.min(IO_CHUNK_BYTES, remaining));
      if (bytes.byteLength === 0) break;
      pending += decoder.decode(bytes, { stream: true });
      let newline = pending.indexOf('\n');
      while (newline >= 0) {
        const line = pending.slice(0, newline).replace(/\r$/, '');
        pending = pending.slice(newline + 1);
        if (line.trim()) yield line;
        newline = pending.indexOf('\n');
      }
      if (pending.length > MAX_LINE_CHARS) {
        throw new BackupError('invalid_archive', 'NDJSON record is too large');
      }
      onReadProgress?.(handle.offset ?? 0, totalBytes);
      await yieldToUi();
    }
    pending += decoder.decode();
    if (pending.trim()) yield pending.replace(/\r$/, '');
    onReadProgress?.(totalBytes, totalBytes);
  } finally {
    await handle.close();
  }
}

async function hashFile(fileUri: string): Promise<string> {
  const handle = await platform.fileSystem.openReadHandle(fileUri);
  const hash = sha256.create();
  try {
    while ((handle.offset ?? 0) < (handle.size ?? 0)) {
      const remaining = (handle.size ?? 0) - (handle.offset ?? 0);
      const bytes = await handle.readBytes(Math.min(HASH_CHUNK_BYTES, remaining));
      if (bytes.byteLength === 0) break;
      hash.update(bytes);
      await yieldToUi();
    }
    return bytesToHex(hash.digest());
  } finally {
    await handle.close();
  }
}

async function messageCounts(accountPubkey: string): Promise<MessageCounts> {
  const rows = await platform.database.rawQuery<{
    messages: number;
  }>(
    'SELECT count(*) AS messages FROM messages WHERE account_pubkey = ?',
    [accountPubkey],
  );
  const row = rows[0];
  return {
    messages: row?.messages ?? 0,
  };
}

async function proximityPeerCount(accountPubkey: string): Promise<number> {
  const rows = await platform.database.rawQuery<{ count: number }>(
    'SELECT count(*) AS count FROM proximity_peers WHERE account_pubkey = ?',
    [accountPubkey],
  );
  return rows[0]?.count ?? 0;
}

async function exportMessages(
  stageUri: string,
  accountPubkey: string,
  total: number,
  onProgress?: PhaseProgressCallback,
): Promise<{ relay: number; proximity: number; identities: number }> {
  const relayWriter = await createNdjsonWriter(`${stageUri}${ARCHIVE_MESSAGES}`);
  const proximityDirectoryUri = `${stageUri}${ARCHIVE_PROXIMITY_DIRECTORY}/`;
  let proximityWriter: NdjsonWriter | null = null;
  let currentProximityPubkey: string | null = null;
  let completed = 0;
  let relay = 0;
  let proximity = 0;
  let identities = 0;
  try {
    for await (const row of platform.database.rawQueryEach<{
      delivery_kind: 'relay' | 'proximity';
      proximity_account_pubkey: string | null;
      rumor: string;
    }>(
      `SELECT c.delivery_kind, c.proximity_account_pubkey, m.rumor
       FROM conversations c INDEXED BY idx_conv_backup_owner
       INNER JOIN messages m INDEXED BY idx_msg_conv_time
         ON m.account_pubkey = c.account_pubkey
        AND m.conversation_key = c.conversation_key
       WHERE c.account_pubkey = ?
       ORDER BY c.delivery_kind ASC, c.proximity_account_pubkey ASC,
                c.conversation_key ASC`,
      [accountPubkey],
    )) {
      if (row.delivery_kind === 'relay') {
        await relayWriter.appendLine(row.rumor);
        relay += 1;
      } else {
        const owner = row.proximity_account_pubkey;
        if (!owner || !/^[0-9a-f]{64}$/.test(owner)) {
          throw new Error('Invalid stored Nearby identity public key');
        }
        if (owner !== currentProximityPubkey) {
          await proximityWriter?.close();
          await platform.fileSystem.makeDirectory(proximityDirectoryUri, {
            idempotent: true,
            intermediates: true,
          });
          currentProximityPubkey = owner;
          proximityWriter = await createNdjsonWriter(
            `${proximityDirectoryUri}${owner}.ndjson`,
          );
          identities += 1;
        }
        await proximityWriter!.appendLine(row.rumor);
        proximity += 1;
      }
      completed += 1;
      if (completed % IMPORT_BATCH === 0) {
        onProgress?.({ phase: 'export_messages', completed, total });
        await yieldToUi();
      }
    }
  } finally {
    await relayWriter.close();
    await proximityWriter?.close();
  }
  onProgress?.({ phase: 'export_messages', completed, total });
  return { relay, proximity, identities };
}

async function exportProximityPeers(
  stageUri: string,
  accountPubkey: string,
  total: number,
  onProgress?: PhaseProgressCallback,
): Promise<number> {
  if (total === 0) return 0;
  await platform.fileSystem.makeDirectory(`${stageUri}${ARCHIVE_PROXIMITY_DIRECTORY}/`, {
    idempotent: true,
    intermediates: true,
  });
  const writer = await createNdjsonWriter(`${stageUri}${ARCHIVE_PROXIMITY_PEERS}`);
  let completed = 0;
  try {
    for await (const row of platform.database.rawQueryEach<{
      proximity_pubkey: string;
      display_name: string;
      nickname: string | null;
      last_seen_at: number;
    }>(
      `SELECT proximity_pubkey, display_name, nickname, last_seen_at
       FROM proximity_peers
       WHERE account_pubkey = ?
       ORDER BY proximity_pubkey ASC`,
      [accountPubkey],
    )) {
      await writer.appendJson({
        pubkey: row.proximity_pubkey,
        displayName: row.display_name,
        nickname: row.nickname,
        lastSeenAt: row.last_seen_at,
      } satisfies ChatArchiveProximityPeer);
      completed += 1;
      if (completed % IMPORT_BATCH === 0) {
        onProgress?.({ phase: 'export_messages', completed, total });
        await yieldToUi();
      }
    }
  } finally {
    await writer.close();
  }
  onProgress?.({ phase: 'export_messages', completed, total });
  return completed;
}

async function exportAttachmentGroup(
  stageUri: string,
  group: AttachmentGroup,
  writer: NdjsonWriter,
): Promise<{ bytes: number; included: boolean }> {
  const ox = group.ox.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(ox) || !group.mime) return { bytes: 0, included: false };
  const sourceUri = await resolveAttachmentPath(attachmentName(ox, group.mime));
  if (!sourceUri) return { bytes: 0, included: false };
  const sourceStat = await platform.fileSystem.stat(sourceUri);
  if (!sourceStat.exists || !sourceStat.size || sourceStat.size <= 0) {
    return { bytes: 0, included: false };
  }
  const sourceSize = sourceStat.size;

  const relativePath = archiveBlobPath(ox);
  await platform.fileSystem.makeDirectory(`${stageUri}blobs/`, {
    idempotent: true,
    intermediates: true,
  });
  const destinationUri = `${stageUri}${relativePath}`;
  await platform.fileSystem.copy(sourceUri, destinationUri, {
    overwrite: true,
  });

  for (const url of group.urls) {
    const record: ChatArchiveAttachment = {
      url,
      sha256: ox,
      mime: group.mime,
      size: sourceSize,
    };
    await writer.appendJson(record);
  }
  return { bytes: sourceSize, included: true };
}

async function exportAttachments(
  stageUri: string,
  accountPubkey: string,
  onProgress?: PhaseProgressCallback,
): Promise<{ count: number; bytes: number; omitted: number }> {
  const countRows = await platform.database.rawQuery<{ count: number }>(
    `SELECT count(*) AS count FROM (
       SELECT DISTINCT au.ox
       FROM message_media mm
       INNER JOIN attachment_urls au ON au.url = mm.url
       INNER JOIN stored_files sf ON sf.ox = au.ox
       WHERE mm.account_pubkey = ? AND mm.source = 'attachment'
     )`,
    [accountPubkey],
  );
  const total = countRows[0]?.count ?? 0;
  const indexUri = `${stageUri}${ARCHIVE_ATTACHMENTS}`;
  const writer = await createNdjsonWriter(indexUri);
  let current: AttachmentGroup | null = null;
  let count = 0;
  let bytes = 0;
  let omitted = 0;

  const flush = async () => {
    if (!current) return;
    try {
      const result = await exportAttachmentGroup(stageUri, current, writer);
      if (result.included) {
        count += 1;
        bytes += result.bytes;
      } else {
        omitted += 1;
      }
    } catch {
      omitted += 1;
    }
    onProgress?.({
      phase: 'export_attachments',
      completed: count + omitted,
      total,
    });
    await yieldToUi();
  };

  try {
    for await (const row of platform.database.rawQueryEach<AttachmentRow>(
      `SELECT DISTINCT au.ox AS ox, sf.mime AS mime, au.url AS url
       FROM message_media mm
       INNER JOIN attachment_urls au ON au.url = mm.url
       INNER JOIN stored_files sf ON sf.ox = au.ox
       WHERE mm.account_pubkey = ? AND mm.source = 'attachment'
       ORDER BY au.ox ASC, au.url ASC`,
      [accountPubkey],
    )) {
      if (!current || current.ox !== row.ox) {
        await flush();
        current = { ox: row.ox, mime: row.mime, urls: [row.url] };
      } else {
        current.urls.push(row.url);
      }
    }
    await flush();
  } finally {
    await writer.close();
  }

  const indexStat = await platform.fileSystem.stat(indexUri);
  if (count === 0 && indexStat.exists) await platform.fileSystem.delete(indexUri);
  return { count, bytes, omitted };
}

/** Export a versioned ZIP archive. Both choices use the same container; a
 * messages-only archive simply omits the attachment index and blob directory. */
export async function exportAccountArchive(
  accountPubkey: string,
  options: { includeAttachments: boolean; onProgress?: ProgressCallback },
): Promise<BackupExportResult> {
  await assertZipModuleAvailable();
  emitPercent(options.onProgress, 'export_messages', 0);
  const [counts, peerCount] = await Promise.all([
    messageCounts(accountPubkey),
    proximityPeerCount(accountPubkey),
  ]);
  if (counts.messages === 0) {
    return {
      messages: 0,
      proximityPeers: 0,
      attachments: 0,
      attachmentBytes: 0,
      omittedAttachments: 0,
      archive: null,
    };
  }

  const itemTotal = counts.messages + peerCount;
  const itemEndPercent = options.includeAttachments ? 80 : 95;

  const stageUri = await createWorkDirectory('export');
  const createdAt = new Date();
  const cacheRoot = await platform.fileSystem.cacheDirectoryUri();
  const cacheDirectoryUri = `${cacheRoot}${BACKUP_CACHE_DIRECTORY_NAME}/`;
  await platform.fileSystem.makeDirectory(cacheDirectoryUri, {
    idempotent: true,
    intermediates: true,
  });
  const archiveUri = `${cacheDirectoryUri}archive-${await platform.deviceCrypto.randomUUID()}.zip`;
  let omittedAttachments = 0;
  try {
    const messages = await exportMessages(
      stageUri,
      accountPubkey,
      counts.messages,
      mapItemProgress(options.onProgress, 0, itemEndPercent, itemTotal, 0),
    );
    const proximityPeers = await exportProximityPeers(
      stageUri,
      accountPubkey,
      peerCount,
      mapItemProgress(options.onProgress, 0, itemEndPercent, itemTotal, counts.messages),
    );
    let attachmentResult = { count: 0, bytes: 0, omitted: 0 };
    if (options.includeAttachments) {
      attachmentResult = await exportAttachments(
        stageUri,
        accountPubkey,
        mapPhaseProgress(options.onProgress, 80, 95),
      );
      omittedAttachments += attachmentResult.omitted;
    }

    await platform.fileSystem.writeText(
      `${stageUri}${ARCHIVE_MANIFEST}`,
      JSON.stringify(
        createChatArchiveManifest({
          accountPubkey,
          messages: messages.relay,
          proximityMessages: messages.proximity,
          proximityIdentities: messages.identities,
          proximityPeers,
          attachments: attachmentResult.count,
          attachmentBytes: attachmentResult.bytes,
        }),
        null,
        2,
      ),
    );

    emitPercent(options.onProgress, 'create_archive', 95);
    const subscription = platform.zipArchive.addProgressListener((progress) => {
      emitPercent(options.onProgress, 'create_archive', 95 + progress * 4);
    });
    try {
      await platform.zipArchive.zip(nativePath(stageUri), nativePath(archiveUri));
    } finally {
      subscription.remove();
    }
    const persistedArchive = await persistLatestAccountArchive(
      accountPubkey,
      archiveUri,
      createdAt,
    );
    emitPercent(options.onProgress, 'create_archive', 100);
    return {
      messages: messages.relay + messages.proximity,
      proximityPeers,
      attachments: attachmentResult.count,
      attachmentBytes: attachmentResult.bytes,
      omittedAttachments,
      archive: persistedArchive,
    };
  } finally {
    const archiveStat = await platform.fileSystem.stat(archiveUri);
    if (archiveStat.exists) await platform.fileSystem.delete(archiveUri);
    await deleteDirectoryQuietly(stageUri);
  }
}

async function isZip(fileUri: string): Promise<boolean> {
  const fileStat = await platform.fileSystem.stat(fileUri);
  if (!fileStat.exists || !fileStat.size || fileStat.size < 4) return false;
  const handle = await platform.fileSystem.openReadHandle(fileUri);
  try {
    const bytes = await handle.readBytes(4);
    return (
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      ((bytes[2] === 0x03 && bytes[3] === 0x04) ||
        (bytes[2] === 0x05 && bytes[3] === 0x06) ||
        (bytes[2] === 0x07 && bytes[3] === 0x08))
    );
  } finally {
    await handle.close();
  }
}

function filenameFromUri(uri: string): string {
  const withoutQuery = uri.split(/[?#]/, 1)[0];
  const encodedName = withoutQuery.slice(withoutQuery.lastIndexOf('/') + 1);
  try {
    return decodeURIComponent(encodedName);
  } catch {
    return encodedName;
  }
}

function blobFilename(file: Blob): string | undefined {
  const name = (file as Blob & { readonly name?: unknown }).name;
  return typeof name === 'string' && name.trim() ? name : undefined;
}

function requireImportKind(filename: string | undefined) {
  const kind = filename ? backupImportKind(filename) : null;
  if (!kind) {
    throw new BackupError(
      'unsupported_file_type',
      'Only ZIP, JSONL, and NDJSON files can be imported',
    );
  }
  return kind;
}

async function assertArchiveTree(
  rootUri: string,
  manifest: ChatArchiveManifest,
): Promise<{ proximityMessageFiles: { pubkey: string; uri: string }[] }> {
  const hasAttachments = manifest.counts.attachments > 0;
  const hasProximity = manifest.counts.proximityMessages > 0 || manifest.counts.proximityPeers > 0;
  const allowedRoot = new Set([
    ARCHIVE_MANIFEST,
    ARCHIVE_MESSAGES,
    ...(hasAttachments ? [ARCHIVE_ATTACHMENTS, 'blobs'] : []),
    ...(hasProximity ? [ARCHIVE_PROXIMITY_DIRECTORY] : []),
  ]);
  for (const entry of await platform.fileSystem.listDirectory(rootUri)) {
    if (!allowedRoot.has(entry.name)) {
      throw new BackupError('invalid_archive', `Unexpected archive entry: ${entry.name}`);
    }
  }

  const proximityMessageFiles: { pubkey: string; uri: string }[] = [];
  if (hasProximity) {
    const proximityUri = `${rootUri}${ARCHIVE_PROXIMITY_DIRECTORY}/`;
    const proximityStat = await platform.fileSystem.stat(proximityUri);
    if (!proximityStat.exists || !proximityStat.isDirectory) {
      throw new BackupError('invalid_archive', 'Nearby history directory is missing');
    }
    let hasPeerIndex = false;
    for (const entry of await platform.fileSystem.listDirectory(proximityUri)) {
      if (entry.isDirectory) {
        throw new BackupError('invalid_archive', 'Unexpected Nearby history entry');
      }
      if (entry.name === 'peers.ndjson') {
        hasPeerIndex = true;
        continue;
      }
      const match = /^([0-9a-f]{64})\.ndjson$/.exec(entry.name);
      if (!match) {
        throw new BackupError('invalid_archive', 'Invalid Nearby history filename');
      }
      proximityMessageFiles.push({ pubkey: match[1], uri: entry.uri });
    }
    if (hasPeerIndex !== manifest.counts.proximityPeers > 0) {
      throw new BackupError('invalid_archive', 'Nearby peer index does not match metadata');
    }
    if (proximityMessageFiles.length !== manifest.counts.proximityIdentities) {
      throw new BackupError('invalid_archive', 'Nearby identity count does not match metadata');
    }
    proximityMessageFiles.sort((a, b) => a.pubkey.localeCompare(b.pubkey));
  }

  if (!hasAttachments) return { proximityMessageFiles };

  const blobsUri = `${rootUri}blobs/`;
  const blobsStat = await platform.fileSystem.stat(blobsUri);
  if (!blobsStat.exists || !blobsStat.isDirectory) {
    throw new BackupError('invalid_archive', 'Attachment blob directory is missing');
  }
  const blobFiles = await platform.fileSystem.listDirectory(blobsUri);
  if (blobFiles.length !== manifest.counts.attachments) {
    throw new BackupError('invalid_archive', 'Attachment file count does not match metadata');
  }
  for (const blob of blobFiles) {
    if (blob.isDirectory || !/^[0-9a-f]{64}$/.test(blob.name)) {
      throw new BackupError('invalid_archive', 'Invalid attachment blob name');
    }
  }
  return { proximityMessageFiles };
}

async function flushMessageBatch(
  accountPubkey: string,
  batch: Rumor[],
  totals: MessageImportTotals,
): Promise<void> {
  if (batch.length === 0) return;
  const result = await dmService.importRumors(accountPubkey, batch);
  totals.inserted += result.inserted;
  totals.existing += result.existing;
  totals.invalid += result.invalid;
  batch.length = 0;
  await yieldToUi();
}

async function flushProximityMessageBatch(
  accountPubkey: string,
  proximityAccountPubkey: string,
  batch: Rumor[],
  totals: MessageImportTotals,
): Promise<void> {
  if (batch.length === 0) return;
  const result = await proximityService.importRumors(accountPubkey, proximityAccountPubkey, batch);
  totals.inserted += result.inserted;
  totals.existing += result.existing;
  totals.invalid += result.invalid;
  batch.length = 0;
  await yieldToUi();
}

function addMessageTotals(target: MessageImportTotals, source: MessageImportTotals): void {
  target.inserted += source.inserted;
  target.existing += source.existing;
  target.invalid += source.invalid;
}

async function importRumorValues(
  accountPubkey: string,
  values: unknown[],
  total: number | null,
  onProgress?: PhaseProgressCallback,
): Promise<MessageImportTotals> {
  const totals: MessageImportTotals = { inserted: 0, existing: 0, invalid: 0 };
  const batch: Rumor[] = [];
  let completed = 0;
  for (const value of values) {
    const rumor = parseBackupRumor(value);
    if (rumor) batch.push(rumor);
    else totals.invalid += 1;
    completed += 1;
    if (batch.length >= IMPORT_BATCH) await flushMessageBatch(accountPubkey, batch, totals);
    onProgress?.({ phase: 'import_messages', completed, total });
  }
  await flushMessageBatch(accountPubkey, batch, totals);
  return totals;
}

async function importNdjsonMessages(
  accountPubkey: string,
  fileUri: string,
  total: number | null,
  onProgress?: PhaseProgressCallback,
): Promise<MessageImportTotals> {
  const totals: MessageImportTotals = { inserted: 0, existing: 0, invalid: 0 };
  const batch: Rumor[] = [];
  let completed = 0;
  for await (const line of readLines(fileUri)) {
    try {
      const value = JSON.parse(line) as unknown;
      const rumor = parseBackupRumor(value);
      if (rumor) batch.push(rumor);
      else totals.invalid += 1;
    } catch {
      totals.invalid += 1;
    }
    completed += 1;
    if (batch.length >= IMPORT_BATCH) await flushMessageBatch(accountPubkey, batch, totals);
    onProgress?.({ phase: 'import_messages', completed, total });
  }
  await flushMessageBatch(accountPubkey, batch, totals);
  return totals;
}

async function importNdjsonProximityMessages(
  accountPubkey: string,
  proximityAccountPubkey: string,
  fileUri: string,
  total: number | null,
  onProgress?: PhaseProgressCallback,
): Promise<MessageImportTotals> {
  const totals: MessageImportTotals = { inserted: 0, existing: 0, invalid: 0 };
  const batch: Rumor[] = [];
  let completed = 0;
  for await (const line of readLines(fileUri)) {
    try {
      const rumor = parseBackupRumor(JSON.parse(line) as unknown);
      if (rumor) batch.push(rumor);
      else totals.invalid += 1;
    } catch {
      totals.invalid += 1;
    }
    completed += 1;
    if (batch.length >= IMPORT_BATCH) {
      await flushProximityMessageBatch(accountPubkey, proximityAccountPubkey, batch, totals);
    }
    onProgress?.({ phase: 'import_messages', completed, total });
  }
  await flushProximityMessageBatch(accountPubkey, proximityAccountPubkey, batch, totals);
  return totals;
}

async function importArchiveProximityPeers(
  accountPubkey: string,
  fileUri: string,
  expected: number,
  onProgress?: PhaseProgressCallback,
): Promise<ProximityPeerImportTotals> {
  const totals: ProximityPeerImportTotals = { restored: 0, invalid: 0 };
  const batch: ChatArchiveProximityPeer[] = [];
  let completed = 0;
  const flush = async () => {
    if (batch.length === 0) return;
    await importProximityPeers(accountPubkey, batch);
    totals.restored += batch.length;
    batch.length = 0;
    await yieldToUi();
  };
  for await (const line of readLines(fileUri)) {
    try {
      const peer = parseChatArchiveProximityPeer(JSON.parse(line) as unknown);
      if (peer) batch.push(peer);
      else totals.invalid += 1;
    } catch {
      totals.invalid += 1;
    }
    completed += 1;
    if (batch.length >= IMPORT_BATCH) await flush();
    onProgress?.({ phase: 'import_messages', completed, total: expected });
  }
  await flush();
  if (completed !== expected) totals.invalid += Math.abs(expected - completed);
  return totals;
}

async function importStandaloneMessages(
  accountPubkey: string,
  fileUri: string,
  onProgress?: ProgressCallback,
): Promise<MessageImportTotals> {
  const fileStat = await platform.fileSystem.stat(fileUri);
  if ((fileStat.size ?? 0) <= SMALL_JSON_BYTES) {
    try {
      const parsed = JSON.parse(await platform.fileSystem.readText(fileUri)) as unknown;
      if (Array.isArray(parsed)) {
        emitPercent(onProgress, 'import_messages', 0);
        const result = await importRumorValues(
          accountPubkey,
          parsed,
          parsed.length,
          mapPhaseProgress(onProgress, 0, 100),
        );
        emitPercent(onProgress, 'import_messages', 100);
        return result;
      }
      emitPercent(onProgress, 'import_messages', 0);
      const result = await importRumorValues(
        accountPubkey,
        [parsed],
        1,
        mapPhaseProgress(onProgress, 0, 100),
      );
      emitPercent(onProgress, 'import_messages', 100);
      return result;
    } catch {
      // A legacy NDJSON file is not one JSON document; stream it below.
    }
  }

  emitPercent(onProgress, 'scan_messages', 0);
  let total = 0;
  for await (const line of readLines(fileUri, (completedBytes, totalBytes) => {
    const ratio = totalBytes > 0 ? completedBytes / totalBytes : 1;
    emitPercent(onProgress, 'scan_messages', ratio * 10);
  })) {
    if (line) total += 1;
  }
  if (total === 0) {
    emitPercent(onProgress, 'import_messages', 100);
    return { inserted: 0, existing: 0, invalid: 0 };
  }
  return importNdjsonMessages(accountPubkey, fileUri, total, mapPhaseProgress(onProgress, 10, 100));
}

async function restoreArchiveBlob(
  rootUri: string,
  record: ChatArchiveAttachment,
): Promise<boolean> {
  await ensureAttachmentDir();
  const destinationUri = await attachmentPath(attachmentName(record.sha256, record.mime));
  const destinationStat = await platform.fileSystem.stat(destinationUri);
  if (destinationStat.exists) return true;

  const sourceUri = `${rootUri}${archiveBlobPath(record.sha256)}`;
  const sourceStat = await platform.fileSystem.stat(sourceUri);
  if (!sourceStat.exists || sourceStat.size !== record.size) return false;
  if ((await hashFile(sourceUri)) !== record.sha256) return false;

  try {
    await platform.fileSystem.copy(sourceUri, destinationUri, {
      overwrite: false,
    });
  } catch (error) {
    // A normal download may have won the race while the archive blob was being
    // verified. Preserve that file instead of replacing it.
    const afterStat = await platform.fileSystem.stat(destinationUri);
    if (!afterStat.exists) throw error;
  }
  return true;
}

async function importArchiveAttachments(
  rootUri: string,
  indexUri: string,
  expected: number,
  expectedBytes: number,
  onProgress?: PhaseProgressCallback,
): Promise<BackupImportResult['attachments']> {
  let current: ChatArchiveAttachment | null = null;
  let currentValid = false;
  let lastSha = '';
  let restored = 0;
  let invalid = 0;
  let seen = 0;
  let restoredBytes = 0;
  let urls: string[] = [];

  const flushUrls = async () => {
    if (!currentValid || !current || urls.length === 0) {
      urls = [];
      return;
    }
    await markImportedBatch(urls, current.sha256, current.mime, current.size);
    urls = [];
  };

  for await (const line of readLines(indexUri)) {
    let record: ChatArchiveAttachment | null = null;
    try {
      record = parseChatArchiveAttachment(JSON.parse(line) as unknown);
    } catch {
      // Count malformed mapping records and continue restoring independent blobs.
    }
    if (!record) {
      invalid += 1;
      continue;
    }
    if (record.sha256 < lastSha) {
      throw new BackupError('invalid_archive', 'Attachment index is not sorted');
    }

    if (!current || current.sha256 !== record.sha256) {
      await flushUrls();
      current = record;
      lastSha = record.sha256;
      seen += 1;
      currentValid = await restoreArchiveBlob(rootUri, record);
      if (currentValid) {
        restored += 1;
        restoredBytes += record.size;
      } else invalid += 1;
      onProgress?.({
        phase: 'import_attachments',
        completed: restored + invalid,
        total: expected,
      });
    } else if (record.mime !== current.mime || record.size !== current.size) {
      invalid += 1;
      continue;
    }

    if (currentValid) {
      urls.push(record.url);
      if (urls.length >= URL_BATCH) await flushUrls();
    }
  }
  await flushUrls();
  if (seen !== expected) invalid += Math.abs(expected - seen);
  if (invalid === 0 && restoredBytes !== expectedBytes) invalid += 1;
  return { restored, invalid };
}

async function importArchive(
  accountPubkey: string,
  archiveUri: string,
  onProgress?: ProgressCallback,
): Promise<BackupImportResult> {
  emitPercent(onProgress, 'open_archive', 0);
  const uncompressedSize = await platform.zipArchive.getUncompressedSize(nativePath(archiveUri));
  if (!Number.isSafeInteger(uncompressedSize) || uncompressedSize < 0) {
    throw new BackupError('invalid_archive', 'Invalid archive size');
  }
  if (uncompressedSize + DISK_SAFETY_BYTES > (await platform.fileSystem.availableDiskSpace())) {
    throw new BackupError('not_enough_space', 'Not enough free space to open archive');
  }

  const rootUri = await createWorkDirectory('import');
  try {
    const subscription = platform.zipArchive.addProgressListener((progress) => {
      emitPercent(onProgress, 'open_archive', progress * 10);
    });
    try {
      await platform.zipArchive.unzip(nativePath(archiveUri), nativePath(rootUri));
    } catch (error) {
      throw new BackupError('invalid_archive', (error as Error).message);
    } finally {
      subscription.remove();
    }

    const manifestUri = `${rootUri}${ARCHIVE_MANIFEST}`;
    const messagesUri = `${rootUri}${ARCHIVE_MESSAGES}`;
    const manifestStat = await platform.fileSystem.stat(manifestUri);
    const messagesStat = await platform.fileSystem.stat(messagesUri);
    if (
      !manifestStat.exists ||
      (manifestStat.size ?? 0) > MAX_MANIFEST_BYTES ||
      !messagesStat.exists
    ) {
      throw new BackupError('invalid_archive', 'Archive metadata is missing');
    }
    let parsedManifest: unknown;
    try {
      parsedManifest = JSON.parse(await platform.fileSystem.readText(manifestUri)) as unknown;
    } catch {
      throw new BackupError('invalid_archive', 'Archive metadata is malformed');
    }
    const manifest = parseChatArchiveManifest(parsedManifest);
    if (!manifest) throw new BackupError('invalid_archive', 'Unsupported archive format');
    if (manifest.accountPubkey !== accountPubkey) {
      throw new BackupError('account_mismatch', 'Archive belongs to another account');
    }

    const attachmentIndexUri = `${rootUri}${ARCHIVE_ATTACHMENTS}`;
    const attachmentIndexStat = await platform.fileSystem.stat(attachmentIndexUri);
    const hasAttachments = manifest.counts.attachments > 0;
    if (hasAttachments !== attachmentIndexStat.exists) {
      throw new BackupError('invalid_archive', 'Attachment index does not match metadata');
    }
    const { proximityMessageFiles } = await assertArchiveTree(rootUri, manifest);

    const totalItems =
      manifest.counts.messages +
      manifest.counts.proximityMessages +
      manifest.counts.proximityPeers +
      manifest.counts.attachments;

    const proximityPeers =
      manifest.counts.proximityPeers > 0
        ? await importArchiveProximityPeers(
            accountPubkey,
            `${rootUri}${ARCHIVE_PROXIMITY_PEERS}`,
            manifest.counts.proximityPeers,
            mapItemProgress(onProgress, 10, 100, totalItems, 0),
          )
        : { restored: 0, invalid: 0 };

    const messages = await importNdjsonMessages(
      accountPubkey,
      messagesUri,
      manifest.counts.messages,
      mapItemProgress(onProgress, 10, 100, totalItems, manifest.counts.proximityPeers),
    );
    const processedMessages = messages.inserted + messages.existing + messages.invalid;
    if (processedMessages !== manifest.counts.messages) {
      messages.invalid += Math.abs(manifest.counts.messages - processedMessages);
    }
    let proximityCompleted = 0;
    for (const file of proximityMessageFiles) {
      const imported = await importNdjsonProximityMessages(
        accountPubkey,
        file.pubkey,
        file.uri,
        manifest.counts.proximityMessages,
        mapItemProgress(
          onProgress,
          10,
          100,
          totalItems,
          manifest.counts.proximityPeers + manifest.counts.messages + proximityCompleted,
        ),
      );
      const processed = imported.inserted + imported.existing + imported.invalid;
      proximityCompleted += processed;
      addMessageTotals(messages, imported);
    }
    if (proximityCompleted !== manifest.counts.proximityMessages) {
      messages.invalid += Math.abs(manifest.counts.proximityMessages - proximityCompleted);
    }
    const attachments = hasAttachments
      ? await importArchiveAttachments(
          rootUri,
          attachmentIndexUri,
          manifest.counts.attachments,
          manifest.sizes.attachments,
          mapItemProgress(
            onProgress,
            10,
            100,
            totalItems,
            manifest.counts.proximityPeers +
              manifest.counts.messages +
              manifest.counts.proximityMessages,
          ),
        )
      : { restored: 0, invalid: 0 };

    emitPercent(onProgress, hasAttachments ? 'import_attachments' : 'import_messages', 100);
    return { source: 'archive', messages, attachments, proximityPeers };
  } finally {
    await deleteDirectoryQuietly(rootUri);
  }
}

/** Import a versioned ZIP archive or a standalone JSONL/NDJSON message file.
 * Standalone input may contain one rumor object, a JSON array, or line-delimited
 * rumor objects, preserving compatibility with earlier message-only exports. */
export async function importAccountArchive(
  accountPubkey: string,
  options?: {
    onProgress?: ProgressCallback;
    file?: Blob;
    uri?: string;
    name?: string;
    temporary?: boolean;
  },
): Promise<BackupImportResult | null> {
  if (options?.file) {
    const name = options.name ?? blobFilename(options.file) ?? '';
    requireImportKind(name);
    return withStagedBackupFile(options.file, (uri) =>
      importAccountArchiveUri(accountPubkey, uri, name, options.onProgress),
    );
  }
  if (options?.uri) {
    try {
      return await importAccountArchiveUri(
        accountPubkey,
        options.uri,
        options.name ?? filenameFromUri(options.uri),
        options.onProgress,
      );
    } finally {
      if (options.temporary) {
        await platform.fileSystem.delete(options.uri, { idempotent: true }).catch(() => {
          // Cache cleanup must not replace the import outcome.
        });
      }
    }
  }
  const picked = await platform.documentPicker.pickDocument({ type: '*/*' });
  if (!picked) return null;
  try {
    return await importAccountArchiveUri(
      accountPubkey,
      picked.uri,
      picked.name,
      options?.onProgress,
    );
  } finally {
    await platform.fileSystem.delete(picked.uri, { idempotent: true }).catch(() => {
      // Picker results are cache copies; cleanup must not replace the import outcome.
    });
  }
}

async function importAccountArchiveUri(
  accountPubkey: string,
  fileUri: string,
  filename: string,
  onProgress?: ProgressCallback,
): Promise<BackupImportResult> {
  const kind = requireImportKind(filename);
  if (kind === 'archive') {
    if (!(await isZip(fileUri))) {
      throw new BackupError('invalid_archive', 'The selected ZIP file is malformed');
    }
    await assertZipModuleAvailable();
    return importArchive(accountPubkey, fileUri, onProgress);
  }
  const messages = await importStandaloneMessages(accountPubkey, fileUri, onProgress);
  if (messages.inserted + messages.existing === 0) {
    throw new BackupError('invalid_archive', 'The file contains no importable messages');
  }
  return {
    source: 'messages',
    messages,
    attachments: { restored: 0, invalid: 0 },
    proximityPeers: { restored: 0, invalid: 0 },
  };
}
