import { Directory, File, FileMode, Paths } from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';

import type {
  DirectoryEntry,
  FileReadHandle,
  FileStat,
  FileSystemPort,
  FileWriteHandle,
} from '../ports/file-system';

/**
 * File storage backed by `expo-file-system`. The modern `File`/`Directory` API
 * and the `/legacy` entry coexist behind the port: each method uses whichever
 * keeps the call site's semantics intact — the legacy API for base64 reads
 * (the only one that resolves Android `content://` URIs), idempotent deletes,
 * legacy throwing-if-exists directory creation, and the native binary upload;
 * the modern API for byte/text reads, streaming handles, relocation with an
 * overwrite flag, downloads, and millisecond-precision stat times.
 */

function statSync(uri: string): FileStat {
  // Probing File first relies on the constructor NOT throwing for directories:
  // today the native module only validates path type in `validateType()` (with
  // an upstream TODO to move that into the constructor). If a future
  // expo-file-system moves it, probe `Directory` first instead.
  const file = new File(uri);
  if (file.exists) {
    const info = file.info();
    return {
      exists: true,
      isDirectory: false,
      size: info.size ?? null,
      creationTime: info.creationTime ?? null,
      modificationTime: info.modificationTime ?? null,
    };
  }
  const directory = new Directory(uri);
  if (directory.exists) {
    return {
      exists: true,
      isDirectory: true,
      size: null,
      creationTime: null,
      modificationTime: null,
    };
  }
  return {
    exists: false,
    isDirectory: false,
    size: null,
    creationTime: null,
    modificationTime: null,
  };
}

function wrapReadHandle(handle: {
  readonly size: number | null;
  offset: number | null;
  readBytes(length: number): Uint8Array;
  close(): void;
}): FileReadHandle {
  return {
    get size() {
      return handle.size;
    },
    get offset() {
      return handle.offset;
    },
    readBytes: (count) => Promise.resolve(handle.readBytes(count)),
    close: () => Promise.resolve(handle.close()),
  };
}

function wrapWriteHandle(handle: {
  writeBytes(bytes: Uint8Array): void;
  close(): void;
}): FileWriteHandle {
  return {
    writeBytes: (bytes) => Promise.resolve(handle.writeBytes(bytes)),
    close: () => Promise.resolve(handle.close()),
  };
}

/** File storage backed by `expo-file-system` (modern + legacy entries). */
export const fileSystemAdapter: FileSystemPort = {
  documentDirectoryUri: () => Promise.resolve(LegacyFileSystem.documentDirectory),
  cacheDirectoryUri: () => Promise.resolve(LegacyFileSystem.cacheDirectory),
  availableDiskSpace: () => Promise.resolve(Paths.availableDiskSpace),

  stat: (uri) => Promise.resolve(statSync(uri)),

  makeDirectory: (uri, options) => {
    if (options?.idempotent) {
      new Directory(uri).create({
        idempotent: true,
        intermediates: options?.intermediates,
      });
      return Promise.resolve();
    }
    // Legacy semantics (what most call sites predate): an existing directory
    // is an error, which callers either pre-check or swallow.
    return LegacyFileSystem.makeDirectoryAsync(uri, {
      intermediates: options?.intermediates,
    });
  },

  listDirectory: (uri) =>
    Promise.resolve(
      new Directory(uri).list().map(
        (entry): DirectoryEntry => ({
          name: entry.name,
          uri: entry.uri,
          isDirectory: entry instanceof Directory,
        }),
      ),
    ),

  readText: (uri) => new File(uri).text(),
  readBase64: (uri) =>
    LegacyFileSystem.readAsStringAsync(uri, {
      encoding: LegacyFileSystem.EncodingType.Base64,
    }),
  readBytes: (uri) => new File(uri).bytes(),

  writeText: (uri, contents) => {
    const file = new File(uri);
    if (!file.exists) file.create();
    file.write(contents);
    return Promise.resolve();
  },

  writeBytes: (uri, bytes) => {
    const file = new File(uri);
    if (!file.exists) file.create();
    file.write(bytes);
    return Promise.resolve();
  },

  openReadHandle: (uri, options) => {
    const handle = new File(uri).open(FileMode.ReadOnly);
    if (options?.offset != null) handle.offset = options.offset;
    return Promise.resolve(wrapReadHandle(handle));
  },

  openWriteHandle: (uri, options) => {
    const file = new File(uri);
    if (options?.truncate ?? true) file.create({ overwrite: true });
    else if (!file.exists) file.create();
    const handle = file.open(FileMode.WriteOnly);
    if (options?.offset != null) handle.offset = options.offset;
    return Promise.resolve(wrapWriteHandle(handle));
  },

  copy: (fromUri, toUri, options) =>
    new File(fromUri).copy(new File(toUri), { overwrite: options?.overwrite }),

  move: (fromUri, toUri) => new File(fromUri).move(new File(toUri)),

  delete: (uri, options) =>
    LegacyFileSystem.deleteAsync(uri, { idempotent: options?.idempotent }),

  downloadFile: async (url, toUri, options) => {
    await File.downloadFileAsync(url, new File(toUri), {
      idempotent: options?.idempotent,
    });
  },

  requestRemoteFile: async (url, options) => {
    const response = await fetch(url, {
      method: options.method,
      headers: options.headers,
      signal: options.signal,
    });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    return {
      status: response.status,
      headers,
      body:
        options.readBody === false || options.method === 'HEAD'
          ? new Uint8Array()
          : new Uint8Array(await response.arrayBuffer()),
    };
  },

  uploadFile: async (url, fileUri, options) => {
    if (options.signal || options.onProgress) {
      if (options.signal?.aborted) {
        const error = new Error('Upload cancelled');
        error.name = 'AbortError';
        throw error;
      }
      const task = LegacyFileSystem.createUploadTask(
        url,
        fileUri,
        {
          httpMethod: options.httpMethod,
          uploadType: LegacyFileSystem.FileSystemUploadType.BINARY_CONTENT,
          headers: options.headers,
          sessionType: LegacyFileSystem.FileSystemSessionType.BACKGROUND,
        },
        (progress) =>
          options.onProgress?.(
            progress.totalBytesSent,
            progress.totalBytesExpectedToSend,
          ),
      );
      const cancel = () => void task.cancelAsync();
      options.signal?.addEventListener('abort', cancel, { once: true });
      try {
        const result = await task.uploadAsync();
        if (!result) {
          const error = new Error('Upload cancelled');
          error.name = 'AbortError';
          throw error;
        }
        return { status: result.status, body: result.body };
      } finally {
        options.signal?.removeEventListener('abort', cancel);
      }
    }
    const result = await LegacyFileSystem.uploadAsync(url, fileUri, {
      httpMethod: options.httpMethod,
      uploadType: LegacyFileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: options.headers,
    });
    return { status: result.status, body: result.body };
  },

  revealInFolder: () => Promise.resolve(false),
};
