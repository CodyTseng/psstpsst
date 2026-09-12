import { createAbortError } from '@/lib/async/abort';

import type { FileSystemPort } from '../ports/file-system';
import { getElectronBridge } from './bridge';

let uploadSequence = 0;
let remoteRequestSequence = 0;

function isManagedUri(uri: string): boolean {
  return uri.startsWith('psstpsst-file://');
}

async function readRendererBytes(uri: string): Promise<Uint8Array> {
  const response = await fetch(uri);
  if (!response.ok) throw new Error(`Unable to read renderer resource (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

export const electronFileSystemAdapter: FileSystemPort = {
  documentDirectoryUri: () => getElectronBridge().fileSystem.documentDirectoryUri(),
  cacheDirectoryUri: () => getElectronBridge().fileSystem.cacheDirectoryUri(),
  availableDiskSpace: () => getElectronBridge().fileSystem.availableDiskSpace(),
  async stat(uri) {
    if (isManagedUri(uri)) return getElectronBridge().fileSystem.stat(uri);
    try {
      const bytes = await readRendererBytes(uri);
      return {
        exists: true,
        isDirectory: false,
        size: bytes.length,
        creationTime: null,
        modificationTime: null,
      };
    } catch {
      return {
        exists: false,
        isDirectory: false,
        size: null,
        creationTime: null,
        modificationTime: null,
      };
    }
  },
  makeDirectory: (uri, options) => getElectronBridge().fileSystem.makeDirectory(uri, options),
  listDirectory: (uri) => getElectronBridge().fileSystem.listDirectory(uri),
  async readText(uri) {
    if (isManagedUri(uri)) return getElectronBridge().fileSystem.readText(uri);
    return new TextDecoder().decode(await readRendererBytes(uri));
  },
  async readBase64(uri) {
    if (isManagedUri(uri)) return getElectronBridge().fileSystem.readBase64(uri);
    const bytes = await readRendererBytes(uri);
    let binary = '';
    const chunkSize = 32 * 1024;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  },
  async readBytes(uri) {
    if (isManagedUri(uri)) return getElectronBridge().fileSystem.readBytes(uri);
    return readRendererBytes(uri);
  },
  writeText: (uri, contents) => getElectronBridge().fileSystem.writeText(uri, contents),
  writeBytes: (uri, bytes) => getElectronBridge().fileSystem.writeBytes(uri, bytes),

  async openReadHandle(uri, options) {
    const opened = await getElectronBridge().fileSystem.openReadHandle(uri, options?.offset);
    let offset = options?.offset ?? 0;
    return {
      size: opened.size,
      get offset() {
        return offset;
      },
      async readBytes(count) {
        const bytes = await getElectronBridge().fileSystem.readHandle(opened.id, count);
        offset += bytes.length;
        return bytes;
      },
      close: () => getElectronBridge().fileSystem.closeReadHandle(opened.id),
    };
  },

  async openWriteHandle(uri, options) {
    const id = await getElectronBridge().fileSystem.openWriteHandle(
      uri,
      options?.offset,
      options?.truncate,
    );
    return {
      writeBytes: (bytes) => getElectronBridge().fileSystem.writeHandle(id, bytes),
      close: () => getElectronBridge().fileSystem.closeWriteHandle(id),
    };
  },

  async copy(fromUri, toUri, options) {
    const bridge = getElectronBridge();
    if (isManagedUri(fromUri)) {
      return bridge.fileSystem.copy(fromUri, toUri, options?.overwrite ?? false);
    }
    if (!options?.overwrite && (await bridge.fileSystem.stat(toUri)).exists) {
      throw new Error('Destination already exists');
    }
    // Electron clipboard files are renderer-owned `blob:` URLs. Main cannot
    // resolve those URLs, so copy their bytes through the typed bridge into a
    // managed destination before the attachment pipeline takes over.
    return bridge.fileSystem.writeBytes(toUri, await readRendererBytes(fromUri));
  },
  move: (fromUri, toUri) => getElectronBridge().fileSystem.move(fromUri, toUri),
  delete: (uri, options) =>
    getElectronBridge().fileSystem.delete(uri, options?.idempotent ?? false),
  downloadFile: (url, toUri, options) =>
    getElectronBridge().fileSystem.downloadFile(url, toUri, options?.idempotent ?? false),
  async requestRemoteFile(url, options) {
    if (options.signal?.aborted) {
      const error = new Error('Download cancelled');
      error.name = 'AbortError';
      throw error;
    }
    remoteRequestSequence += 1;
    const operationId = `renderer-remote-${Date.now()}-${remoteRequestSequence}`;
    const cancel = () => {
      void getElectronBridge().fileSystem.cancelRemoteFileRequest(operationId);
    };
    options.signal?.addEventListener('abort', cancel, { once: true });
    try {
      return await getElectronBridge().fileSystem.requestRemoteFile(
        url,
        {
          method: options.method,
          headers: options.headers,
          readBody: options.readBody,
        },
        operationId,
      );
    } catch (error) {
      if (options.signal?.aborted) {
        const cancelled = new Error('Download cancelled');
        cancelled.name = 'AbortError';
        throw cancelled;
      }
      throw error;
    } finally {
      options.signal?.removeEventListener('abort', cancel);
    }
  },
  async uploadFile(url, fileUri, options) {
    if (options.signal?.aborted) {
      const error = new Error('Upload cancelled');
      error.name = 'AbortError';
      throw error;
    }
    uploadSequence += 1;
    const operationId = `renderer-upload-${Date.now()}-${uploadSequence}`;
    const cancel = () => {
      void getElectronBridge().fileSystem.cancelUpload?.(operationId);
    };
    const removeProgressListener = getElectronBridge().fileSystem.addUploadProgressListener?.(
      (progress) => {
        if (progress.operationId === operationId) {
          options.onProgress?.(progress.sentBytes, progress.totalBytes);
        }
      },
    );
    options.signal?.addEventListener('abort', cancel, { once: true });
    try {
      const result = await getElectronBridge().fileSystem.uploadFile(
        url,
        fileUri,
        { httpMethod: options.httpMethod, headers: options.headers },
        operationId,
      );
      if (result.cancelled || options.signal?.aborted) {
        throw createAbortError('Upload cancelled');
      }
      return result;
    } catch (error) {
      if (options.signal?.aborted) {
        throw createAbortError('Upload cancelled');
      }
      throw error;
    } finally {
      removeProgressListener?.();
      options.signal?.removeEventListener('abort', cancel);
    }
  },
  revealInFolder: (uri) => {
    const reveal = getElectronBridge().fileSystem.revealInFolder;
    return reveal ? reveal(uri) : Promise.resolve(false);
  },
};
