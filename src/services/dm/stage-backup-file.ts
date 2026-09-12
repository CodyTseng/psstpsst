import { platform } from '@/platform';

const COPY_CHUNK_BYTES = 1024 * 1024;

/** Stage browser-owned input in bounded chunks and keep it alive through import. */
export async function withStagedBackupFile<T>(
  file: Blob,
  consume: (uri: string) => Promise<T>,
): Promise<T> {
  const cache = await platform.fileSystem.cacheDirectoryUri();
  if (!cache) throw new Error('Backup cache is unavailable');
  const uri = `${cache}backup-drop-${await platform.deviceCrypto.randomUUID()}`;
  try {
    const writer = await platform.fileSystem.openWriteHandle(uri);
    try {
      for (let offset = 0; offset < file.size; offset += COPY_CHUNK_BYTES) {
        const bytes = await file.slice(offset, offset + COPY_CHUNK_BYTES).arrayBuffer();
        await writer.writeBytes(new Uint8Array(bytes));
      }
    } finally {
      await writer.close();
    }
    return await consume(uri);
  } finally {
    await platform.fileSystem.delete(uri, { idempotent: true }).catch(() => {
      // Cache cleanup must not replace the import outcome.
    });
  }
}
