/**
 * Port for the app's on-device file storage: the persistent document directory
 * and the OS-evictable cache, plus the handful of file operations the services
 * layer actually performs (attachment pool, pending-upload staging, chat-archive
 * export/import, Blossom up/downloads).
 *
 * URIs are opaque strings (`file://…`, or `content://…` for Android picker
 * results) — the port never exposes platform path types, so a desktop adapter
 * can back it with `node:fs` without call-site changes. Base-directory values
 * embed an OS container id that changes across reinstalls, so callers rebuild
 * absolute URIs from {@link FileSystemPort.documentDirectoryUri} /
 * {@link FileSystemPort.cacheDirectoryUri} each time and persist only relative
 * names.
 *
 * All methods are async-first — see the module note in `secure-storage.ts`.
 * The Expo adapter resolves several of them synchronously under the hood (the
 * modern `File`/`Directory` API is sync), but no call site may depend on that.
 */

/** One entry of a directory listing. */
export type DirectoryEntry = {
  /** Bare entry name (no path separators), e.g. `a3f2….jpg`. */
  name: string;
  /** Absolute URI of the entry, ready to pass back into the port. */
  uri: string;
  isDirectory: boolean;
};

/** Metadata snapshot of a filesystem path. */
export type FileStat = {
  exists: boolean;
  isDirectory: boolean;
  /** Byte size for a file; null for a directory or a missing/unreadable path. */
  size: number | null;
  /** Creation time in milliseconds since epoch, when the platform reports it. */
  creationTime: number | null;
  /** Last-modification time in milliseconds since epoch, when reported. */
  modificationTime: number | null;
};

export type RemoteFileResponse = {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
};

/**
 * Incremental reader over an open file. `size` and `offset` are byte positions
 * readable synchronously because the adapter already holds them locally (an
 * adapter backed by an IPC channel tracks the offset itself); only the actual
 * I/O is async. Reads advance the offset.
 */
export interface FileReadHandle {
  readonly size: number | null;
  readonly offset: number | null;
  readBytes(count: number): Promise<Uint8Array>;
  close(): Promise<void>;
}

/** Incremental writer over an open file; writes append at the cursor. */
export interface FileWriteHandle {
  writeBytes(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

export interface FileSystemPort {
  /**
   * Absolute URI of the persistent document directory (trailing slash
   * included), or null when the platform provides none.
   */
  documentDirectoryUri(): Promise<string | null>;
  /**
   * Absolute URI of the OS-evictable cache directory (trailing slash
   * included), or null when the platform provides none.
   */
  cacheDirectoryUri(): Promise<string | null>;
  /** Free bytes on the volume holding the app's storage. */
  availableDiskSpace(): Promise<number>;

  /** Stat a path without opening it; `exists: false` for a missing path. */
  stat(uri: string): Promise<FileStat>;
  /**
   * Create a directory. With `intermediates`, missing parents are created too.
   * Without `idempotent`, an existing directory is an error.
   */
  makeDirectory(
    uri: string,
    options?: { intermediates?: boolean; idempotent?: boolean },
  ): Promise<void>;
  /**
   * List a directory's direct children. Throws when the directory is missing.
   */
  listDirectory(uri: string): Promise<DirectoryEntry[]>;

  /** Read a whole file as UTF-8 text. */
  readText(uri: string): Promise<string>;
  /**
   * Read a whole file as a base64 string. This is the encoding that also
   * resolves `content://` URIs on Android, which the byte reader does not.
   */
  readBase64(uri: string): Promise<string>;
  /**
   * Read a whole file as bytes. Only handles real filesystem paths
   * (`file://…` or `/…`) — use {@link readBase64} for `content://` URIs.
   */
  readBytes(uri: string): Promise<Uint8Array>;

  /**
   * Write UTF-8 text to a file, creating it when missing and replacing any
   * existing content.
   */
  writeText(uri: string, contents: string): Promise<void>;
  /**
   * Write bytes to a file, creating it when missing and replacing any
   * existing content.
   */
  writeBytes(uri: string, bytes: Uint8Array): Promise<void>;

  /** Open an existing file for incremental reading. Throws when missing. */
  openReadHandle(uri: string, options?: { offset?: number }): Promise<FileReadHandle>;
  /**
   * Open a file for incremental writing at the start. The file is created
   * when missing and truncated when it already exists.
   */
  openWriteHandle(
    uri: string,
    options?: { offset?: number; truncate?: boolean },
  ): Promise<FileWriteHandle>;

  /**
   * Copy a file. Without `overwrite`, an existing destination is an error.
   */
  copy(fromUri: string, toUri: string, options?: { overwrite?: boolean }): Promise<void>;
  /** Move/rename a file. */
  move(fromUri: string, toUri: string): Promise<void>;
  /**
   * Delete a file, or a directory with everything inside it. Without
   * `idempotent`, a missing path is an error.
   */
  delete(uri: string, options?: { idempotent?: boolean }): Promise<void>;

  /**
   * Download a URL to a local file. With `idempotent`, an existing
   * destination is overwritten instead of being an error.
   */
  downloadFile(url: string, toUri: string, options?: { idempotent?: boolean }): Promise<void>;
  /**
   * Perform a bounded file-protocol HTTP request. Electron routes this through
   * its main process so media servers do not depend on browser CORS headers.
   */
  requestRemoteFile(
    url: string,
    options: {
      method: 'GET' | 'HEAD';
      headers?: Record<string, string>;
      readBody?: boolean;
      signal?: AbortSignal;
    },
  ): Promise<RemoteFileResponse>;
  /**
   * Upload a local file as the raw binary request body (the native upload
   * path — RN's `fetch` can mangle binary bodies). The returned `body` is the
   * response text; any HTTP status resolves, only transport failures reject.
   */
  uploadFile(
    url: string,
    fileUri: string,
    options: {
      httpMethod: 'POST' | 'PUT' | 'PATCH';
      headers?: Record<string, string>;
      signal?: AbortSignal;
      onProgress?: (sentBytes: number, totalBytes: number) => void;
    },
  ): Promise<{ status: number; body: string }>;

  /**
   * Ask the desktop file manager to reveal a managed file and select it when
   * possible. Returns false on platforms without this presentation capability.
   */
  revealInFolder(uri: string): Promise<boolean>;
}
