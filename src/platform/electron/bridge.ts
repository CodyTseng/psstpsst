import type { SqlBindValue, SqliteQueryMethod } from '../ports/database';
import type { AppUpdateStatus } from '../ports/app-update';
import type {
  ConfirmationDialogOptions,
  NoticeDialogOptions,
} from '../ports/confirmation-dialog';
import type { WindowChromeTheme } from '../ports/window-chrome';
import type { NotificationPresentationContent } from '../ports/notifications';

export type ElectronFileStat = {
  exists: boolean;
  isDirectory: boolean;
  size: number | null;
  creationTime: number | null;
  modificationTime: number | null;
};

export type ElectronDirectoryEntry = {
  name: string;
  uri: string;
  isDirectory: boolean;
};

export type ElectronBridge = {
  appUpdate: {
    check(): Promise<AppUpdateStatus>;
    getStatus(): Promise<AppUpdateStatus>;
    download(): Promise<void>;
    install(): Promise<void>;
    onStatus(listener: (status: AppUpdateStatus) => void): () => void;
  };
  database: {
    execute(
      sql: string,
      params: SqlBindValue[],
      method: SqliteQueryMethod,
      transactionId?: string,
    ): Promise<{ rows: unknown }>;
    begin(parentTransactionId?: string): Promise<string>;
    commit(transactionId: string): Promise<void>;
    rollback(transactionId: string): Promise<void>;
    exec(sql: string, transactionId?: string): Promise<void>;
    runBatch(
      sql: string,
      paramsBatch: SqlBindValue[][],
      transactionId?: string,
    ): Promise<void>;
    streamOpen(sql: string, params: SqlBindValue[]): Promise<string>;
    streamNext<T>(streamId: string): Promise<{ rows: T[]; done: boolean }>;
    streamClose(streamId: string): Promise<void>;
    onChange(listener: (event: { tableName?: string }) => void): () => void;
  };
  secureStorage: {
    accessStatus(): Promise<'available' | 'password_setup_required' | 'password_required'>;
    configurePassword(password: string): Promise<void>;
    unlockWithPassword(password: string): Promise<boolean>;
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    deleteItem(key: string): Promise<void>;
  };
  fileSystem: {
    documentDirectoryUri(): Promise<string>;
    cacheDirectoryUri(): Promise<string>;
    availableDiskSpace(): Promise<number>;
    stat(uri: string): Promise<ElectronFileStat>;
    makeDirectory(
      uri: string,
      options?: { intermediates?: boolean; idempotent?: boolean },
    ): Promise<void>;
    listDirectory(uri: string): Promise<ElectronDirectoryEntry[]>;
    readText(uri: string): Promise<string>;
    readBase64(uri: string): Promise<string>;
    readBytes(uri: string): Promise<Uint8Array>;
    writeText(uri: string, contents: string): Promise<void>;
    writeBytes(uri: string, bytes: Uint8Array): Promise<void>;
    openReadHandle(uri: string, offset?: number): Promise<{ id: string; size: number }>;
    readHandle(id: string, count: number): Promise<Uint8Array>;
    closeReadHandle(id: string): Promise<void>;
    openWriteHandle(uri: string, offset?: number, truncate?: boolean): Promise<string>;
    writeHandle(id: string, bytes: Uint8Array): Promise<void>;
    closeWriteHandle(id: string): Promise<void>;
    copy(fromUri: string, toUri: string, overwrite: boolean): Promise<void>;
    move(fromUri: string, toUri: string): Promise<void>;
    delete(uri: string, idempotent: boolean): Promise<void>;
    downloadFile(url: string, toUri: string, overwrite: boolean): Promise<void>;
    requestRemoteFile(
      url: string,
      options: {
        method: 'GET' | 'HEAD';
        headers?: Record<string, string>;
        readBody?: boolean;
      },
      operationId: string,
    ): Promise<{ status: number; headers: Record<string, string>; body: Uint8Array }>;
    cancelRemoteFileRequest(operationId: string): Promise<void>;
    uploadFile(
      url: string,
      fileUri: string,
      options: { httpMethod: 'POST' | 'PUT' | 'PATCH'; headers?: Record<string, string> },
      operationId: string,
    ): Promise<{ status: number; body: string; cancelled?: boolean }>;
    /** Optional so a hot-reloaded renderer can tolerate an older preload until restart. */
    addUploadProgressListener?(
      listener: (value: { operationId: string; sentBytes: number; totalBytes: number }) => void,
    ): () => void;
    /** Optional so a hot-reloaded renderer can stop cooperatively until preload restarts. */
    cancelUpload?(operationId: string): Promise<void>;
    /** Optional so a hot-reloaded renderer can tolerate an older preload until restart. */
    revealInFolder?(uri: string): Promise<boolean>;
  };
  deviceCrypto: {
    randomUUID(): Promise<string>;
    sha256Hex(data: Uint8Array): Promise<string>;
    aesGcmEncrypt(
      plain: Uint8Array,
      key: Uint8Array,
      nonceLength: number,
    ): Promise<{ cipher: Uint8Array; nonce: Uint8Array }>;
    aesGcmDecrypt(
      cipher: Uint8Array,
      key: Uint8Array,
      nonce: Uint8Array,
      tagLength: number,
    ): Promise<Uint8Array>;
    aesGcmSeal(
      plain: Uint8Array,
      key: Uint8Array,
      iv: Uint8Array,
      additionalData: Uint8Array,
    ): Promise<Uint8Array>;
    aesGcmOpen(
      cipher: Uint8Array,
      key: Uint8Array,
      iv: Uint8Array,
      additionalData: Uint8Array,
    ): Promise<Uint8Array>;
  };
  noise: {
    generateKeyPair(seed?: Uint8Array): Promise<{ privateKey: Uint8Array; publicKey: Uint8Array }>;
    createHandshake(
      role: 'initiator' | 'responder',
      staticPrivateKey: Uint8Array,
      fixedEphemeralPrivateKey?: Uint8Array,
    ): Promise<string>;
    writeHandshake(handle: string, payload: Uint8Array): Promise<Uint8Array>;
    readHandshake(handle: string, message: Uint8Array): Promise<Uint8Array>;
    getRemoteStaticKey(handle: string): Promise<Uint8Array>;
    finishHandshake(
      handle: string,
      maxRecordSize: number,
    ): Promise<{ handle: string; sessionId: Uint8Array }>;
    destroyHandshake(handle: string): Promise<void>;
    shouldRotateSession(handle: string, nextPayloadLength: number): Promise<boolean>;
    seal(handle: string, type: number, payload: Uint8Array): Promise<Uint8Array>;
    open(handle: string, record: Uint8Array): Promise<{ type: number; payload: Uint8Array }>;
    destroySession(handle: string): Promise<void>;
  };
  dialogs: {
    confirm(options: ConfirmationDialogOptions): Promise<boolean>;
    notify(options: NoticeDialogOptions): Promise<void>;
    pickDocument(mimeType: string): Promise<{ uri: string; name: string } | null>;
    saveFile(sourceUri: string, suggestedName: string): Promise<boolean>;
    saveMedia(sourceUri: string): Promise<boolean>;
    shareFile(sourceUri: string, suggestedName: string): Promise<boolean>;
  };
  image: {
    renderAndSave(
      uri: string,
      options: {
        resize?: { width?: number; height?: number };
        format: 'jpeg' | 'png' | 'webp';
        quality: number;
        includeBase64?: boolean;
      },
    ): Promise<{ uri: string; width: number; height: number; base64?: string }>;
  };
  zip: {
    create(sourceUri: string, targetUri: string): Promise<void>;
    extract(sourceUri: string, targetUri: string): Promise<void>;
    uncompressedSize(archiveUri: string): Promise<number>;
    onProgress(listener: (progress: number) => void): () => void;
  };
  notifications: {
    isSupported(): boolean;
    hasPermission(): Promise<boolean>;
    ensurePermission(): Promise<boolean>;
    openSettings(): Promise<boolean>;
    show(content: NotificationPresentationContent): Promise<boolean>;
    dismissAll(): Promise<void>;
  };
  windowFocus: {
    /** Cached in preload from main-process visibility/focus events — hence sync. */
    isFocused(): boolean;
    onChange(listener: (focused: boolean) => void): () => void;
  };
  deepLink: {
    takePendingUrl(): Promise<string | null>;
    onAvailable(listener: () => void): () => void;
  };
  localAuth: {
    hasEnrolledAuth(): Promise<boolean>;
    authenticate(reason: string): Promise<boolean>;
  };
  tray: {
    setUnreadCount(count: number): Promise<void>;
  };
  windowChrome: {
    setTheme(theme: WindowChromeTheme): Promise<void>;
    setScreenshotPreview(enabled: boolean): Promise<void>;
  };
  proximity: {
    isAvailable(): boolean;
    requestPermissions(): Promise<boolean>;
    startAdvertising(profile: string): Promise<void>;
    updateProfile(profile: string): Promise<void>;
    preferPeripheral(endpointId: string): Promise<void>;
    disconnect(endpointId: string): Promise<void>;
    startScan(scanDurationMs: number): Promise<void>;
    stopScan(): Promise<void>;
    stopSession(): Promise<void>;
    refreshPeerProfile(endpointId: string): Promise<void>;
    send(endpointId: string, payload: string): Promise<void>;
    onEvent(listener: (name: string, event: Record<string, unknown>) => void): () => void;
  };
  backgroundTask: {
    setRunner(run: () => Promise<void>): void;
    register(minimumIntervalMinutes: number): Promise<void>;
    unregister(): Promise<void>;
  };
  system: {
    openRuntimeNotices(): Promise<void>;
    openExternalUrl(url: string): Promise<void>;
    platform: NodeJS.Platform;
  };
};

declare global {
  interface Window {
    psstpsstDesktop?: ElectronBridge;
  }
}

export function getElectronBridge(): ElectronBridge {
  const bridge = window.psstpsstDesktop;
  if (!bridge) throw new Error('The Electron preload bridge is unavailable');
  return bridge;
}
