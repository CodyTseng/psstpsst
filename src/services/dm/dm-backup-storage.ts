import { platform } from '@/platform';

export const BACKUP_CACHE_DIRECTORY_NAME = 'psstpsst-chat-archives';
const PERSISTED_ARCHIVE_DIRECTORY = 'psstpsst-chat-archives';
const ACCOUNT_PUBKEY_PATTERN = /^[0-9a-f]{64}$/;
const MANAGED_ARCHIVE_PATTERN =
  /^psstpsst-chat-history-\d{4}-\d{2}-\d{2}-\d{6}-[0-9a-f]{8}\.zip$/;
const TEMP_ARCHIVE_PATTERN =
  /^psstpsst-chat-history-\d{4}-\d{2}-\d{2}-\d{6}-[0-9a-f]{8}\.zip\.tmp$/;

export type BackupArchiveInfo = {
  accountPubkey: string;
  name: string;
  size: number;
  createdAt: number;
};

function assertAccountPubkey(accountPubkey: string): void {
  if (!ACCOUNT_PUBKEY_PATTERN.test(accountPubkey)) {
    throw new Error('Invalid account pubkey');
  }
}

async function persistedArchiveRootUri(): Promise<string> {
  const base = await platform.fileSystem.documentDirectoryUri();
  if (!base) throw new Error('FileSystem.documentDirectory unavailable');
  return `${base}${PERSISTED_ARCHIVE_DIRECTORY}/`;
}

async function persistedArchiveDirectoryUri(accountPubkey: string): Promise<string> {
  assertAccountPubkey(accountPubkey);
  return `${await persistedArchiveRootUri()}${accountPubkey}/`;
}

async function persistedArchiveFileUri(accountPubkey: string, name: string): Promise<string> {
  if (!MANAGED_ARCHIVE_PATTERN.test(name)) throw new Error('Invalid archive filename');
  return `${await persistedArchiveDirectoryUri(accountPubkey)}${name}`;
}

async function archiveFilename(createdAt: Date): Promise<string> {
  const timestamp = createdAt
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .slice(0, 15);
  const uuid = await platform.deviceCrypto.randomUUID();
  const date = `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6)}`;
  return `psstpsst-chat-history-${date}-${uuid.slice(0, 8)}.zip`;
}

function archiveInfo(
  accountPubkey: string,
  name: string,
  stat: { size: number | null; creationTime: number | null; modificationTime: number | null },
): BackupArchiveInfo {
  return {
    accountPubkey,
    name,
    size: stat.size ?? 0,
    createdAt: stat.creationTime ?? stat.modificationTime ?? Date.now(),
  };
}

export async function persistLatestAccountArchive(
  accountPubkey: string,
  sourceUri: string,
  createdAt: Date,
): Promise<BackupArchiveInfo> {
  const directoryUri = await persistedArchiveDirectoryUri(accountPubkey);
  await platform.fileSystem.makeDirectory(directoryUri, {
    idempotent: true,
    intermediates: true,
  });
  const finalName = await archiveFilename(createdAt);
  const temporaryUri = `${directoryUri}${finalName}.tmp`;
  const destinationUri = `${directoryUri}${finalName}`;
  try {
    await platform.fileSystem.copy(sourceUri, temporaryUri);
    const sourceStat = await platform.fileSystem.stat(sourceUri);
    const temporaryStat = await platform.fileSystem.stat(temporaryUri);
    if (
      !temporaryStat.exists ||
      temporaryStat.size !== sourceStat.size ||
      !temporaryStat.size ||
      temporaryStat.size <= 0
    ) {
      throw new Error('Persisted archive verification failed');
    }
    await platform.fileSystem.move(temporaryUri, destinationUri);
    const destinationStat = await platform.fileSystem.stat(destinationUri);
    if (
      !destinationStat.exists ||
      destinationStat.size !== sourceStat.size ||
      !destinationStat.size ||
      destinationStat.size <= 0
    ) {
      throw new Error('Persisted archive commit failed');
    }
  } catch (error) {
    const temporaryStat = await platform.fileSystem.stat(temporaryUri);
    if (temporaryStat.exists) await platform.fileSystem.delete(temporaryUri);
    const destinationStat = await platform.fileSystem.stat(destinationUri);
    if (destinationStat.exists) await platform.fileSystem.delete(destinationUri);
    throw error;
  }

  for (const entry of await platform.fileSystem.listDirectory(directoryUri)) {
    if (
      !entry.isDirectory &&
      entry.name !== finalName &&
      MANAGED_ARCHIVE_PATTERN.test(entry.name)
    ) {
      try {
        await platform.fileSystem.delete(entry.uri);
      } catch {
        // A stale archive can be retried after the next successful export.
      }
    }
  }
  return archiveInfo(accountPubkey, finalName, await platform.fileSystem.stat(destinationUri));
}

async function cleanupTempFiles(directoryUri: string): Promise<void> {
  for (const entry of await platform.fileSystem.listDirectory(directoryUri)) {
    if (!entry.isDirectory && TEMP_ARCHIVE_PATTERN.test(entry.name)) {
      await platform.fileSystem.delete(entry.uri);
    }
  }
}

/** Remove incomplete commits and cache work left by a terminated process. */
export async function cleanupInterruptedBackupArtifacts(): Promise<void> {
  const archiveRootUri = await persistedArchiveRootUri();
  const rootStat = await platform.fileSystem.stat(archiveRootUri);
  if (rootStat.exists) {
    for (const entry of await platform.fileSystem.listDirectory(archiveRootUri)) {
      if (!entry.isDirectory || !ACCOUNT_PUBKEY_PATTERN.test(entry.name)) continue;
      await cleanupTempFiles(entry.uri);
      const remaining = await platform.fileSystem.listDirectory(entry.uri);
      if (remaining.length === 0) await platform.fileSystem.delete(entry.uri);
    }
  }

  const cacheBase = await platform.fileSystem.cacheDirectoryUri();
  if (!cacheBase) return;

  const workParentUri = `${cacheBase}${BACKUP_CACHE_DIRECTORY_NAME}/`;
  const workParentStat = await platform.fileSystem.stat(workParentUri);
  if (workParentStat.exists) await platform.fileSystem.delete(workParentUri);

  const legacyCacheArchivePattern = /^psstpsst-chat-history-[0-9a-f-]{36}\.zip$/;
  for (const entry of await platform.fileSystem.listDirectory(cacheBase)) {
    if (!entry.isDirectory && legacyCacheArchivePattern.test(entry.name)) {
      await platform.fileSystem.delete(entry.uri);
    }
  }
}

export async function getLatestAccountArchive(
  accountPubkey: string,
): Promise<BackupArchiveInfo | null> {
  const directoryUri = await persistedArchiveDirectoryUri(accountPubkey);
  const directoryStat = await platform.fileSystem.stat(directoryUri);
  if (!directoryStat.exists) return null;

  let latest: { name: string; uri: string } | null = null;
  let latestTime = -1;
  for (const entry of await platform.fileSystem.listDirectory(directoryUri)) {
    if (entry.isDirectory || !MANAGED_ARCHIVE_PATTERN.test(entry.name)) continue;
    const entryStat = await platform.fileSystem.stat(entry.uri);
    const time = entryStat.creationTime ?? entryStat.modificationTime ?? 0;
    if (entryStat.exists && entryStat.size && entryStat.size > 0 && time >= latestTime) {
      latest = entry;
      latestTime = time;
    }
  }
  return latest
    ? archiveInfo(accountPubkey, latest.name, await platform.fileSystem.stat(latest.uri))
    : null;
}

export async function shareAccountArchive(archive: BackupArchiveInfo): Promise<boolean> {
  const fileUri = await persistedArchiveFileUri(archive.accountPubkey, archive.name);
  const fileStat = await platform.fileSystem.stat(fileUri);
  if (!fileStat.exists || !fileStat.size || fileStat.size <= 0) return false;
  if (!(await platform.sharing.isAvailable())) return false;
  await platform.sharing.share(fileUri, {
    mimeType: 'application/zip',
    dialogTitle: 'PsstPsst chat archive',
    uti: 'public.zip-archive',
  });
  return true;
}

export async function revealAccountArchive(archive: BackupArchiveInfo): Promise<boolean> {
  const fileUri = await persistedArchiveFileUri(archive.accountPubkey, archive.name);
  const fileStat = await platform.fileSystem.stat(fileUri);
  if (!fileStat.exists || !fileStat.size || fileStat.size <= 0) return false;
  return platform.fileSystem.revealInFolder(fileUri);
}

export async function deleteAccountArchive(archive: BackupArchiveInfo): Promise<void> {
  const fileUri = await persistedArchiveFileUri(archive.accountPubkey, archive.name);
  const fileStat = await platform.fileSystem.stat(fileUri);
  if (fileStat.exists) await platform.fileSystem.delete(fileUri);
}

export async function deleteAllAccountArchives(accountPubkey: string): Promise<void> {
  const directoryUri = await persistedArchiveDirectoryUri(accountPubkey);
  const directoryStat = await platform.fileSystem.stat(directoryUri);
  if (!directoryStat.exists) return;
  for (const entry of await platform.fileSystem.listDirectory(directoryUri)) {
    if (
      !entry.isDirectory &&
      (MANAGED_ARCHIVE_PATTERN.test(entry.name) || TEMP_ARCHIVE_PATTERN.test(entry.name))
    ) {
      await platform.fileSystem.delete(entry.uri);
    }
  }
  const remaining = await platform.fileSystem.listDirectory(directoryUri);
  if (remaining.length === 0) await platform.fileSystem.delete(directoryUri);
}
