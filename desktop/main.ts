import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { autoUpdater } from 'electron-updater';
import sharp from 'sharp';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  nativeImage,
  nativeTheme,
  Notification,
  protocol,
  shell,
  screen,
  systemPreferences,
  Tray,
  webContents,
  type IpcMainInvokeEvent,
  type MessageBoxOptions,
  type NativeImage,
} from 'electron';

import { formatBadgeCount } from '../src/lib/badge-count';
import { NOSTR_EVENT_URL_PREFERENCE_KEY } from '../src/lib/nostr/event-url';
import { DesktopAppUpdater } from './app-updater';
import { BackgroundScheduler } from './background-scheduler';
import { DatabaseService } from './database-service';
import { FileService } from './file-service';
import { EXTERNAL_SCHEMES, openExternalUrl } from './external-url';
import { NoiseService } from './noise-service';
import { IPC } from './ipc-channels';
import { ProximityService } from './proximity-service';
import { SecureStorageService } from './secure-storage-service';
import { trayUnreadSvg, trayUnreadTitle } from './tray-unread-icon';
import { configureTrayInteractions } from './tray-interactions';
import {
  ScreenshotPreviewWindow,
  WindowStateStore,
  fitWindowBounds,
  WINDOW_MIN_WIDTH,
  WINDOW_MIN_HEIGHT,
} from './window-state';
import { isWindowUserPresent } from './window-presence';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
  {
    scheme: 'psstpsst-file',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

let mainWindow: BrowserWindow | null = null;
let windowStateStore: WindowStateStore | null = null;
const screenshotPreviewWindow = new ScreenshotPreviewWindow();
let databaseService: DatabaseService | null = null;
let fileService: FileService | null = null;
let secureStorageService: SecureStorageService | null = null;
let proximityService: ProximityService | null = null;
let noiseService: NoiseService | null = null;
let appUpdateService: DesktopAppUpdater | null = null;
const notifications = new Map<string, Notification>();
const backgroundScheduler = new BackgroundScheduler({
  canRun: () => mainWindow !== null && !mainWindow.isDestroyed(),
  startRun: (runId) => mainWindow?.webContents.send(IPC.backgroundRun, runId),
});
let backgroundConfigPath = '';
let shuttingDown = false;
let tray: Tray | null = null;
let trayBaseIcon: NativeImage | null = null;
let trayUnreadRevision = 0;
const trayUnreadIcons = new Map<string, NativeImage>();
let pendingDeepLink: string | null = null;

const APP_SCHEME = 'psstpsst';
const DEVELOPMENT_RENDERER_ORIGIN = resolveDevelopmentRendererOrigin();
const NOTIFICATION_ICON_MAX_BYTES = 5 * 1024 * 1024;
const UPDATE_CHECK_DELAY_MS = 5_000;

// Mirrors the `background` / `surfaceMuted` / `text` tokens in `src/theme` —
// the main process cannot import the RN-coupled theme module, so keep these
// values in sync. Used for the pre-render window paint and the Windows/Linux
// caption overlay; the renderer reports the effective theme over IPC once it loads.
const WINDOW_CHROME_COLORS = {
  light: { background: '#F2F2F7', titlebar: '#E5E5EA', text: '#0F0F10' },
  dark: { background: '#09090B', titlebar: '#101013', text: '#F5F5F7' },
} as const;
// Matches the renderer title-bar strip height (`desktopChrome.titlebarHeight`).
const TITLEBAR_OVERLAY_HEIGHT = process.platform === 'darwin' ? 28 : 40;
// Vertically centres the 12px-diameter traffic lights in the 28px strip:
// (28 - 12) / 2. The x offset keeps the `hiddenInset` default.
const TRAFFIC_LIGHT_POSITION = { x: 12, y: 8 } as const;

function resolveDevelopmentRendererOrigin(): string | null {
  const value = process.env.PSSTPSST_RENDERER_URL;
  if (!value) return null;
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== 'localhost' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(`Unsupported Electron development renderer URL: ${value}`);
  }
  return url.origin;
}

function isTrustedRendererLocation(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === 'app:' && url.hostname === 'renderer') return true;
    return DEVELOPMENT_RENDERER_ORIGIN !== null && url.origin === DEVELOPMENT_RENDERER_ORIGIN;
  } catch {
    return false;
  }
}

function appDeepLinkFromArgs(args: string[]): string | null {
  return args.find((value) => {
    try {
      return new URL(value).protocol === `${APP_SCHEME}:`;
    } catch {
      return false;
    }
  }) ?? null;
}

function deliverDeepLink(value: string): void {
  if (!appDeepLinkFromArgs([value])) return;
  pendingDeepLink = value;
  mainWindow?.webContents.send(IPC.deepLinkAvailable);
}

function showMainWindow(): void {
  if (!app.isReady()) return;
  if (!mainWindow || mainWindow.isDestroyed()) {
    void openWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function setTrayUnreadCount(count: number): Promise<void> {
  const currentTray = tray;
  if (!currentTray) return;
  const revision = ++trayUnreadRevision;
  if (process.platform === 'darwin') {
    currentTray.setTitle(trayUnreadTitle(count), { fontType: 'monospacedDigit' });
    return;
  }
  const label = count > 0 ? formatBadgeCount(count) : '';
  if (!label) {
    if (trayBaseIcon) currentTray.setImage(trayBaseIcon);
    return;
  }
  const logicalSize = process.platform === 'win32' ? 16 : 22;
  const cacheKey = `${logicalSize}:${label}`;
  let icon = trayUnreadIcons.get(cacheKey);
  if (!icon) {
    const physicalSize = logicalSize * 2;
    const png = await sharp(Buffer.from(trayUnreadSvg(count, physicalSize))).png().toBuffer();
    icon = nativeImage.createFromBuffer(png, { scaleFactor: 2 });
    trayUnreadIcons.set(cacheKey, icon);
  }
  if (tray === currentTray && revision === trayUnreadRevision) currentTray.setImage(icon);
}

function scheduleBackgroundTask(minimumIntervalMinutes: number): void {
  backgroundScheduler.start(minimumIntervalMinutes);
}

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  if (!mainWindow || event.sender !== mainWindow.webContents) return false;
  if (event.senderFrame !== event.sender.mainFrame) return false;
  return isTrustedRendererLocation(event.senderFrame.url);
}

function handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedSender(event)) throw new Error('Rejected IPC from an untrusted sender');
    return listener(event, ...args);
  });
}

function services() {
  if (!databaseService || !fileService || !secureStorageService) {
    throw new Error('Desktop services have not initialized');
  }
  return { database: databaseService, files: fileService, secure: secureStorageService };
}

function validateString(value: unknown, name: string, maxLength = 4 * 1024 * 1024): string {
  if (typeof value !== 'string' || value.length > maxLength) throw new Error(`Invalid ${name}`);
  return value;
}

function validateBytes(value: unknown, name: string, maxLength = 256 * 1024 * 1024): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength > maxLength) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
}

function validateHexColor(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
}

function validateHeaders(value: unknown): Record<string, string> | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid headers');
  const entries = Object.entries(value);
  if (entries.length > 32) throw new Error('Invalid headers');
  return Object.fromEntries(
    entries.map(([key, headerValue]) => [
      validateString(key, 'header name', 256),
      validateString(headerValue, 'header value', 8 * 1024),
    ]),
  );
}

async function loadNotificationIcon(value: unknown): Promise<NativeImage | undefined> {
  if (value == null) return undefined;
  try {
    const url = new URL(validateString(value, 'notification avatar URL', 4 * 1024));
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    const response = await net.fetch(url.toString());
    if (!response.ok || !response.body) return undefined;
    const declaredSize = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredSize) && declaredSize > NOTIFICATION_ICON_MAX_BYTES) {
      await response.body.cancel();
      return undefined;
    }

    const chunks: Uint8Array[] = [];
    const reader = response.body.getReader();
    let size = 0;
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      size += chunk.byteLength;
      if (size > NOTIFICATION_ICON_MAX_BYTES) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(chunk);
    }
    const icon = nativeImage.createFromBuffer(
      Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))),
    );
    return icon.isEmpty() ? undefined : icon.resize({ width: 128, height: 128, quality: 'good' });
  } catch {
    return undefined;
  }
}

function registerIpcHandlers(): void {
  handle(IPC.appUpdateGetStatus, () => appUpdateService?.getStatus() ?? { state: 'idle' });
  handle(IPC.appUpdateDownload, () => {
    if (!appUpdateService) throw new Error('Application updater is unavailable');
    return appUpdateService.download();
  });
  handle(IPC.appUpdateInstall, () => {
    if (!appUpdateService) throw new Error('Application updater is unavailable');
    return appUpdateService.install();
  });
  handle(IPC.databaseExecute, (event, sql, params, method, transactionId) => {
    if (!['run', 'all', 'values', 'get'].includes(method)) {
      throw new Error('Invalid SQLite query method');
    }
    if (!Array.isArray(params) || params.length > 100_000) throw new Error('Invalid SQL params');
    return services().database.execute(
      event.sender.id,
      validateString(sql, 'SQL'),
      params,
      method,
      transactionId,
    );
  });
  handle(IPC.databaseBegin, (event, parentId) =>
    services().database.begin(event.sender.id, parentId),
  );
  handle(IPC.databaseCommit, (event, id) =>
    services().database.commit(event.sender.id, validateString(id, 'transaction id', 100)),
  );
  handle(IPC.databaseRollback, (event, id) =>
    services().database.rollback(event.sender.id, validateString(id, 'transaction id', 100)),
  );
  handle(IPC.databaseExec, (event, sql, transactionId) =>
    services().database.exec(event.sender.id, validateString(sql, 'SQL'), transactionId),
  );
  handle(IPC.databaseRunBatch, (event, sql, paramsBatch, transactionId) =>
    services().database.runBatch(
      event.sender.id,
      validateString(sql, 'SQL'),
      Array.isArray(paramsBatch) && paramsBatch.length <= 100_000
        ? paramsBatch
        : (() => {
            throw new Error('Invalid SQL batch');
          })(),
      transactionId,
    ),
  );
  handle(IPC.databaseStreamOpen, (event, sql, params) =>
    services().database.streamOpen(
      event.sender.id,
      validateString(sql, 'SQL'),
      Array.isArray(params) && params.length <= 100_000
        ? params
        : (() => {
            throw new Error('Invalid SQL params');
          })(),
    ),
  );
  handle(IPC.databaseStreamNext, (event, id) =>
    services().database.streamNext(event.sender.id, validateString(id, 'stream id', 100)),
  );
  handle(IPC.databaseStreamClose, (event, id) =>
    services().database.streamClose(event.sender.id, validateString(id, 'stream id', 100)),
  );

  handle(IPC.secureGet, (_event, key) => services().secure.getItem(validateString(key, 'key', 512)));
  handle(IPC.secureAccessStatus, () => services().secure.accessStatus());
  handle(IPC.secureConfigurePassword, (_event, password) =>
    services().secure.configurePassword(validateString(password, 'application password', 256)),
  );
  handle(IPC.secureUnlockWithPassword, (_event, password) =>
    services().secure.unlockWithPassword(validateString(password, 'application password', 256)),
  );
  handle(IPC.secureSet, (_event, key, value) =>
    services().secure.setItem(validateString(key, 'key', 512), validateString(value, 'value')),
  );
  handle(IPC.secureDelete, (_event, key) =>
    services().secure.deleteItem(validateString(key, 'key', 512)),
  );

  handle(IPC.proximityRequestPermissions, () => proximityService!.requestPermissions());
  handle(IPC.proximityStartAdvertising, (_event, profile) =>
    proximityService!.startAdvertising(validateString(profile, 'proximity profile', 16 * 1024)),
  );
  handle(IPC.proximityUpdateProfile, (_event, profile) =>
    proximityService!.updateProfile(validateString(profile, 'proximity profile', 16 * 1024)),
  );
  handle(IPC.proximityPreferPeripheral, (_event, endpointId) =>
    proximityService!.preferPeripheral(validateString(endpointId, 'proximity endpoint', 256)),
  );
  handle(IPC.proximityDisconnect, (_event, endpointId) =>
    proximityService!.disconnect(validateString(endpointId, 'proximity endpoint', 256)),
  );
  handle(IPC.proximityStartScan, (_event, scanDurationMs) => {
    if (!Number.isSafeInteger(scanDurationMs) || scanDurationMs < 0 || scanDurationMs > 300_000) {
      throw new Error('Invalid proximity scan duration');
    }
    return proximityService!.startScan(scanDurationMs);
  });
  handle(IPC.proximityStopScan, () => proximityService!.stopScan());
  handle(IPC.proximityStopSession, () => proximityService!.stopSession());
  handle(IPC.proximityRefreshPeerProfile, (_event, endpointId) =>
    proximityService!.refreshPeerProfile(validateString(endpointId, 'proximity endpoint', 256)),
  );
  handle(IPC.proximitySend, async (_event, endpointId, payload) => {
    try {
      await proximityService!.send(
        validateString(endpointId, 'proximity endpoint', 256),
        validateString(payload, 'proximity payload', 128 * 1024),
      );
      return { ok: true } as const;
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Nearby send failed',
      } as const;
    }
  });
  handle(IPC.traySetUnreadCount, (_event, count) => {
    if (!Number.isSafeInteger(count) || count < 0 || count > 1_000_000) {
      throw new Error('Invalid tray unread count');
    }
    // The same total also rides the macOS dock badge (no-op elsewhere handled
    // by the platform guard; Windows/Linux show the count on the tray icon).
    if (process.platform === 'darwin') app.setBadgeCount(count);
    return setTrayUnreadCount(count);
  });
  handle(IPC.windowChromeSetTheme, (event, theme) => {
    const value = (theme ?? {}) as {
      backgroundColor?: unknown;
      titlebarColor?: unknown;
      symbolColor?: unknown;
      transparentTitlebar?: unknown;
    };
    const backgroundColor = validateHexColor(value.backgroundColor, 'window background');
    const titlebarColor = validateHexColor(value.titlebarColor, 'title bar background');
    const symbolColor = validateHexColor(value.symbolColor, 'title bar symbol');
    if (
      value.transparentTitlebar !== undefined &&
      typeof value.transparentTitlebar !== 'boolean'
    ) {
      throw new TypeError('Invalid transparent title bar flag');
    }
    const transparentTitlebar = value.transparentTitlebar === true;
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    window.setBackgroundColor(backgroundColor);
    // macOS keeps its inset traffic lights over the renderer's title strip;
    // Windows/Linux draw native caption buttons onto this themed overlay.
    if (process.platform !== 'darwin') {
      window.setTitleBarOverlay({
        color: transparentTitlebar ? 'rgba(0, 0, 0, 0)' : titlebarColor,
        symbolColor,
        height: TITLEBAR_OVERLAY_HEIGHT,
      });
    }
  });
  handle(IPC.windowChromeSetScreenshotPreview, (event, enabled) => {
    if (typeof enabled !== 'boolean') throw new TypeError('Invalid screenshot preview flag');
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    if (enabled) {
      windowStateStore?.capture(window);
      screenshotPreviewWindow.enter(
        window,
        screen.getDisplayMatching(window.getNormalBounds()).workArea,
      );
      return;
    }
    screenshotPreviewWindow.exit(
      window,
      screen.getDisplayMatching(window.getNormalBounds()).workArea,
    );
  });

  handle(IPC.fsDocumentDirectory, () => services().files.directoryUri('documents'));
  handle(IPC.fsCacheDirectory, () => services().files.directoryUri('cache'));
  handle(IPC.fsAvailableDiskSpace, () => services().files.availableDiskSpace());
  handle(IPC.fsStat, (_event, uri) => services().files.stat(validateString(uri, 'file URI')));
  handle(IPC.fsMakeDirectory, (_event, uri, options) =>
    services().files.makeDirectory(validateString(uri, 'file URI'), options),
  );
  handle(IPC.fsListDirectory, (_event, uri) =>
    services().files.listDirectory(validateString(uri, 'file URI')),
  );
  handle(IPC.fsReadText, (_event, uri) =>
    services().files.readText(validateString(uri, 'file URI')),
  );
  handle(IPC.fsReadBase64, (_event, uri) =>
    services().files.readBase64(validateString(uri, 'file URI')),
  );
  handle(IPC.fsReadBytes, (_event, uri) =>
    services().files.readBytes(validateString(uri, 'file URI')),
  );
  handle(IPC.fsWriteText, (_event, uri, contents) =>
    services().files.writeText(
      validateString(uri, 'file URI'),
      validateString(contents, 'file contents', 64 * 1024 * 1024),
    ),
  );
  handle(IPC.fsWriteBytes, (_event, uri, bytes) =>
    services().files.writeBytes(validateString(uri, 'file URI'), validateBytes(bytes, 'file bytes')),
  );
  handle(IPC.fsOpenReadHandle, (event, uri, offset) => {
    if (offset != null && (!Number.isSafeInteger(offset) || offset < 0)) {
      throw new Error('Invalid read offset');
    }
    return services().files.openReadHandle(
      event.sender.id,
      validateString(uri, 'file URI'),
      offset ?? 0,
    );
  });
  handle(IPC.fsReadHandle, (event, id, count) =>
    services().files.readHandle(event.sender.id, validateString(id, 'read handle', 100), count),
  );
  handle(IPC.fsCloseReadHandle, (event, id) =>
    services().files.closeReadHandle(event.sender.id, validateString(id, 'read handle', 100)),
  );
  handle(IPC.fsOpenWriteHandle, (event, uri, offset, truncate) => {
    if (offset != null && (!Number.isSafeInteger(offset) || offset < 0)) {
      throw new Error('Invalid write offset');
    }
    if (truncate != null && typeof truncate !== 'boolean') {
      throw new Error('Invalid truncate option');
    }
    return services().files.openWriteHandle(
      event.sender.id,
      validateString(uri, 'file URI'),
      offset ?? 0,
      truncate ?? true,
    );
  });
  handle(IPC.fsWriteHandle, (event, id, bytes) =>
    services().files.writeHandle(
      event.sender.id,
      validateString(id, 'write handle', 100),
      validateBytes(bytes, 'write chunk', 16 * 1024 * 1024),
    ),
  );
  handle(IPC.fsCloseWriteHandle, (event, id) =>
    services().files.closeWriteHandle(event.sender.id, validateString(id, 'write handle', 100)),
  );
  handle(IPC.fsCopy, (_event, fromUri, toUri, overwrite) =>
    services().files.copy(
      validateString(fromUri, 'source URI'),
      validateString(toUri, 'destination URI'),
      overwrite === true,
    ),
  );
  handle(IPC.fsMove, (_event, fromUri, toUri) =>
    services().files.move(
      validateString(fromUri, 'source URI'),
      validateString(toUri, 'destination URI'),
    ),
  );
  handle(IPC.fsDelete, (_event, uri, idempotent) =>
    services().files.delete(validateString(uri, 'file URI'), idempotent === true),
  );
  handle(IPC.fsDownload, (_event, url, toUri, overwrite) =>
    services().files.downloadFile(
      validateString(url, 'download URL'),
      validateString(toUri, 'destination URI'),
      overwrite === true,
    ),
  );
  handle(IPC.fsRequestRemote, (event, url, options, operationId) => {
    if (
      !options ||
      (options.method !== 'GET' && options.method !== 'HEAD') ||
      (options.readBody != null && typeof options.readBody !== 'boolean')
    ) {
      throw new Error('Invalid remote file request options');
    }
    return services().files.requestRemoteFile(
      event.sender.id,
      validateString(url, 'remote file URL'),
      {
        method: options.method,
        headers: validateHeaders(options.headers),
        readBody: options.readBody,
      },
      validateString(operationId, 'remote file operation ID', 100),
    );
  });
  handle(IPC.fsCancelRemoteRequest, (event, operationId) => {
    services().files.cancelRemoteFileRequest(
      event.sender.id,
      validateString(operationId, 'remote file operation ID', 100),
    );
  });
  handle(IPC.fsUpload, (event, url, fileUri, options, operationId) => {
    if (!options || !['POST', 'PUT', 'PATCH'].includes(options.httpMethod)) {
      throw new Error('Invalid upload options');
    }
    const safeOperationId = validateString(operationId, 'upload operation ID');
    return services().files.uploadFile(
      event.sender.id,
      validateString(url, 'upload URL'),
      validateString(fileUri, 'file URI'),
      options,
      safeOperationId,
      (sentBytes, totalBytes) =>
        event.sender.send(IPC.fsUploadProgress, {
          operationId: safeOperationId,
          sentBytes,
          totalBytes,
        }),
    );
  });
  handle(IPC.fsCancelUpload, (event, operationId) => {
    services().files.cancelUpload(
      event.sender.id,
      validateString(operationId, 'upload operation ID'),
    );
  });
  handle(IPC.fsRevealInFolder, async (_event, uri) => {
    const safeUri = validateString(uri, 'file URI');
    const stat = await services().files.stat(safeUri);
    if (!stat.exists || stat.isDirectory) return false;
    shell.showItemInFolder(services().files.resolve(safeUri));
    return true;
  });

  handle(IPC.cryptoRandomUuid, () => randomUUID());
  handle(IPC.cryptoSha256, (_event, data) =>
    createHash('sha256').update(validateBytes(data, 'digest input')).digest('hex'),
  );
  handle(IPC.cryptoEncrypt, (_event, plain, key, nonceLength) => {
    if (nonceLength !== 12) throw new Error('AES-GCM requires a 12-byte nonce');
    const keyBytes = validateBytes(key, 'AES key', 32);
    if (keyBytes.length !== 32) throw new Error('AES-GCM requires a 32-byte key');
    const nonce = randomBytes(nonceLength);
    const cipher = createCipheriv('aes-256-gcm', keyBytes, nonce);
    const encrypted = Buffer.concat([
      cipher.update(validateBytes(plain, 'plaintext')),
      cipher.final(),
    ]);
    return { cipher: Buffer.concat([encrypted, cipher.getAuthTag()]), nonce };
  });
  handle(IPC.cryptoDecrypt, (_event, sealed, key, nonce, tagLength) => {
    const bytes = Buffer.from(validateBytes(sealed, 'ciphertext'));
    const keyBytes = validateBytes(key, 'AES key', 32);
    const nonceBytes = validateBytes(nonce, 'AES nonce', 12);
    if (keyBytes.length !== 32 || nonceBytes.length !== 12) {
      throw new Error('Invalid AES-GCM key or nonce');
    }
    if (tagLength !== 16 || bytes.length < tagLength) throw new Error('Invalid AES-GCM payload');
    const decipher = createDecipheriv('aes-256-gcm', keyBytes, nonceBytes);
    decipher.setAuthTag(bytes.subarray(bytes.length - tagLength));
    return Buffer.concat([
      decipher.update(bytes.subarray(0, bytes.length - tagLength)),
      decipher.final(),
    ]);
  });
  handle(IPC.cryptoSeal, (_event, plain, key, iv, additionalData) => {
    const keyBytes = validateBytes(key, 'AES key', 32);
    const ivBytes = validateBytes(iv, 'AES IV', 12);
    if (keyBytes.length !== 32 || ivBytes.length !== 12) {
      throw new Error('Invalid AES-GCM key or IV');
    }
    const cipher = createCipheriv('aes-256-gcm', keyBytes, ivBytes);
    cipher.setAAD(validateBytes(additionalData, 'AES additional data'));
    const encrypted = Buffer.concat([
      cipher.update(validateBytes(plain, 'plaintext')),
      cipher.final(),
    ]);
    return Buffer.concat([encrypted, cipher.getAuthTag()]);
  });
  handle(IPC.cryptoOpen, (_event, sealed, key, iv, additionalData) => {
    const bytes = Buffer.from(validateBytes(sealed, 'ciphertext'));
    const keyBytes = validateBytes(key, 'AES key', 32);
    const ivBytes = validateBytes(iv, 'AES IV', 12);
    if (keyBytes.length !== 32 || ivBytes.length !== 12 || bytes.length < 16) {
      throw new Error('Invalid AES-GCM record');
    }
    const decipher = createDecipheriv('aes-256-gcm', keyBytes, ivBytes);
    decipher.setAAD(validateBytes(additionalData, 'AES additional data'));
    decipher.setAuthTag(bytes.subarray(bytes.length - 16));
    return Buffer.concat([
      decipher.update(bytes.subarray(0, bytes.length - 16)),
      decipher.final(),
    ]);
  });
  handle(IPC.noiseCall, (_event, method, ...args) => {
    if (!noiseService) throw new Error('Noise service has not initialized');
    const handleValue = (value: unknown) => validateString(value, 'Noise handle', 100);
    switch (method) {
      case 'generateKeyPair': {
        const seed = args[0];
        if (seed == null) return noiseService.generateKeyPair();
        const seedBytes = validateBytes(seed, 'Noise seed', 32);
        if (seedBytes.length !== 32) throw new Error('Invalid Noise seed');
        return noiseService.generateKeyPair(seedBytes);
      }
      case 'createHandshake': {
        const role = args[0];
        if (role !== 'initiator' && role !== 'responder') throw new Error('Invalid Noise role');
        const staticPrivateKey = validateBytes(args[1], 'Noise static key', 32);
        if (staticPrivateKey.length !== 32) throw new Error('Invalid Noise static key');
        const ephemeral = args[2];
        const fixedEphemeralPrivateKey =
          ephemeral == null ? undefined : validateBytes(ephemeral, 'Noise ephemeral key', 32);
        if (fixedEphemeralPrivateKey && fixedEphemeralPrivateKey.length !== 32) {
          throw new Error('Invalid Noise ephemeral key');
        }
        return noiseService.createHandshake(role, staticPrivateKey, fixedEphemeralPrivateKey);
      }
      case 'writeHandshake':
        return noiseService.writeHandshake(
          handleValue(args[0]),
          validateBytes(args[1], 'Noise handshake payload', 65_535),
        );
      case 'readHandshake':
        return noiseService.readHandshake(
          handleValue(args[0]),
          validateBytes(args[1], 'Noise handshake message', 65_535),
        );
      case 'getRemoteStaticKey':
        return noiseService.getRemoteStaticKey(handleValue(args[0]));
      case 'finishHandshake': {
        const maxRecordSize = args[1];
        if (
          !Number.isSafeInteger(maxRecordSize) ||
          (maxRecordSize as number) < 512 ||
          (maxRecordSize as number) > 65_583
        ) {
          throw new Error('Invalid Noise record limit');
        }
        return noiseService.finishHandshake(handleValue(args[0]), maxRecordSize as number);
      }
      case 'destroyHandshake':
        return noiseService.destroyHandshake(handleValue(args[0]));
      case 'shouldRotateSession': {
        const nextPayloadLength = args[1];
        if (
          !Number.isSafeInteger(nextPayloadLength) ||
          (nextPayloadLength as number) < 0 ||
          (nextPayloadLength as number) > 65_519
        ) {
          throw new Error('Invalid Noise payload length');
        }
        return noiseService.shouldRotateSession(
          handleValue(args[0]),
          nextPayloadLength as number,
        );
      }
      case 'seal': {
        const type = args[1];
        if (!Number.isSafeInteger(type) || (type as number) < 0 || (type as number) > 255) {
          throw new Error('Invalid Noise packet type');
        }
        return noiseService.seal(
          handleValue(args[0]),
          type as number,
          validateBytes(args[2], 'Noise plaintext', 65_519),
        );
      }
      case 'open':
        return noiseService.open(
          handleValue(args[0]),
          validateBytes(args[1], 'Noise record', 65_583),
        );
      case 'destroySession':
        return noiseService.destroySession(handleValue(args[0]));
      default:
        throw new Error('Unsupported Noise operation');
    }
  });

  handle(IPC.dialogConfirm, async (_event, options) => {
    if (!options || typeof options !== 'object') throw new Error('Invalid dialog options');
    const title = validateString(options.title, 'dialog title', 512);
    const message = validateString(options.message, 'dialog message', 4 * 1024);
    const cancelLabel = validateString(options.cancelLabel, 'cancel label', 128);
    const confirmLabel = validateString(options.confirmLabel, 'confirm label', 128);
    const dialogOptions: MessageBoxOptions = {
      type: options.destructive === true ? 'warning' : 'question',
      title,
      message: title,
      detail: message,
      buttons: [cancelLabel, confirmLabel],
      // Match the renderer dialog (ConfirmationDialogHost): Enter confirms a
      // non-destructive action, but a destructive one defaults to Cancel.
      defaultId: options.destructive === true ? 0 : 1,
      cancelId: 0,
      noLink: true,
    };
    const result = mainWindow
      ? await dialog.showMessageBox(mainWindow, dialogOptions)
      : await dialog.showMessageBox(dialogOptions);
    return result.response === 1;
  });
  handle(IPC.dialogNotify, async (_event, options) => {
    if (!options || typeof options !== 'object') throw new Error('Invalid dialog options');
    const title = validateString(options.title, 'dialog title', 512);
    const message = options.message === undefined
      ? undefined
      : validateString(options.message, 'dialog message', 4 * 1024);
    const okLabel = validateString(options.okLabel, 'OK label', 128);
    const dialogOptions: MessageBoxOptions = {
      type: 'info',
      title,
      message: title,
      detail: message,
      buttons: [okLabel],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    };
    if (mainWindow) await dialog.showMessageBox(mainWindow, dialogOptions);
    else await dialog.showMessageBox(dialogOptions);
  });
  handle(IPC.dialogPickDocument, (event) => services().files.pickDocument(event.sender));
  handle(IPC.dialogSaveFile, (event, uri, name) =>
    services().files.saveFile(
      event.sender,
      validateString(uri, 'file URI'),
      validateString(name, 'filename', 512),
    ),
  );
  handle(IPC.dialogSaveMedia, (event, uri) => {
    const safeUri = validateString(uri, 'file URI');
    return services().files.saveFile(
      event.sender,
      safeUri,
      decodeURIComponent(safeUri.split('/').pop() ?? 'psstpsst-media'),
    );
  });
  handle(IPC.dialogShareFile, async (event, uri, name) => {
    const safeUri = validateString(uri, 'file URI');
    if (await services().files.shareFile(event.sender, safeUri)) return true;
    return services().files.saveFile(
      event.sender,
      safeUri,
      validateString(name, 'filename', 512),
    );
  });
  handle(IPC.imageRender, (_event, uri, options) =>
    services().files.renderImage(validateString(uri, 'file URI'), options),
  );
  handle(IPC.zipCreate, (event, sourceUri, targetUri) =>
    services().files.zip(
      validateString(sourceUri, 'source URI'),
      validateString(targetUri, 'target URI'),
      (progress) => event.sender.send(IPC.zipProgress, progress),
    ),
  );
  handle(IPC.zipExtract, (event, sourceUri, targetUri) =>
    services().files.unzip(
      validateString(sourceUri, 'source URI'),
      validateString(targetUri, 'target URI'),
      (progress) => event.sender.send(IPC.zipProgress, progress),
    ),
  );
  handle(IPC.zipUncompressedSize, (_event, uri) =>
    services().files.uncompressedSize(validateString(uri, 'archive URI')),
  );

  // Synchronous query (the bridge contract is sync): preload asks once via
  // `sendSync` at startup, so this uses `on` + `returnValue`, not `handle`.
  ipcMain.on(IPC.notificationSupported, (event) => {
    event.returnValue = Notification.isSupported();
  });
  handle(IPC.notificationShow, async (_event, content) => {
    if (!Notification.isSupported()) return false;
    if (!content || typeof content !== 'object') {
      throw new TypeError('notification content must be an object');
    }
    const input = content as Record<string, unknown>;
    const validatedTitle = validateString(input.title, 'notification title', 256);
    const subtitle = input.subtitle == null
      ? undefined
      : validateString(input.subtitle, 'notification subtitle', 256);
    const body = input.body == null
      ? undefined
      : validateString(input.body, 'notification body', 4 * 1024);
    const icon = await loadNotificationIcon(input.avatarUrl);
    if (mainWindow && isWindowUserPresent(mainWindow)) return true;
    const id = randomUUID();
    const notification = new Notification({
      id,
      title: validatedTitle,
      subtitle,
      body,
      icon,
    });
    notification.once('close', () => notifications.delete(id));
    notifications.set(id, notification);
    notification.on('click', showMainWindow);
    console.info(`[notifications] Desktop notification requested; id=${id}`);
    return new Promise<boolean>((resolve) => {
      let completed = false;
      const complete = (delivered: boolean, error?: unknown) => {
        if (completed) return;
        completed = true;
        if (delivered) {
          console.info(`[notifications] Desktop notification shown; id=${id}`);
        } else {
          const message = error instanceof Error ? error.message : String(error);
          console.error(
            `[notifications] Desktop notification failed; id=${id}; error=${message}`,
          );
        }
        resolve(delivered);
      };
      notification.once('show', () => complete(true));
      notification.once('failed', (_failedEvent, error) => {
        notifications.delete(id);
        complete(false, error);
      });
      try {
        notification.show();
      } catch (error) {
        notifications.delete(id);
        complete(false, error);
      }
    });
  });
  handle(IPC.notificationDismissAll, () => {
    for (const notification of notifications.values()) notification.close();
    notifications.clear();
  });
  handle(IPC.deepLinkTakePending, () => {
    const value = pendingDeepLink;
    pendingDeepLink = null;
    return value;
  });
  handle(IPC.localAuthHasEnrolled, () =>
    process.platform === 'darwin' && systemPreferences.canPromptTouchID(),
  );
  handle(IPC.localAuthAuthenticate, async (_event, reason) => {
    if (process.platform !== 'darwin' || !systemPreferences.canPromptTouchID()) return false;
    try {
      await systemPreferences.promptTouchID(
        validateString(reason, 'authentication reason', 256),
      );
      return true;
    } catch {
      return false;
    }
  });
  handle(IPC.backgroundRegister, async (_event, value) => {
    const minutes = Number(value);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 24 * 60) {
      throw new Error('Invalid background-task interval');
    }
    await fs.writeFile(backgroundConfigPath, JSON.stringify({ minimumIntervalMinutes: minutes }));
    scheduleBackgroundTask(minutes);
  });
  handle(IPC.backgroundUnregister, async () => {
    backgroundScheduler.stop();
    await fs.rm(backgroundConfigPath, { force: true });
  });
  ipcMain.on(IPC.backgroundComplete, (event, runId) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return;
    if (event.senderFrame !== event.sender.mainFrame) return;
    if (typeof runId === 'string') backgroundScheduler.complete(runId);
  });
  handle(IPC.systemOpenRuntimeNotices, async () => {
    // A fixed bundled document, never a renderer-provided filesystem path.
    const noticePath = app.isPackaged
      ? path.join(process.resourcesPath, 'ThirdPartyNotices/electron/LICENSES.chromium.html')
      : path.resolve(__dirname, '../../node_modules/electron/dist/LICENSES.chromium.html');
    const error = await shell.openPath(noticePath);
    if (error) throw new Error(error);
  });
  handle(IPC.systemOpenExternal, async (event, value) => {
    await openExternalUrl(validateString(value, 'external URL'), {
      readNostrEventUrl: async () => {
        const { rows } = await services().database.execute(
          event.sender.id,
          'SELECT value FROM device_preferences WHERE key = ? LIMIT 1',
          [NOSTR_EVENT_URL_PREFERENCE_KEY],
          'get',
        );
        return Array.isArray(rows) && typeof rows[0] === 'string' ? rows[0] : null;
      },
      open: (url) => shell.openExternal(url),
    });
  });
}

async function registerProtocols(): Promise<void> {
  protocol.handle('psstpsst-file', (request) => net.fetch(services().files.fileUrl(request.url)));
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'renderer') return new Response('Not found', { status: 404 });
    const rendererRoot = path.join(__dirname, 'renderer');
    const requestedPath = decodeURIComponent(url.pathname).replace(/^[/\\]+/, '');
    let target = path.resolve(rendererRoot, requestedPath || 'index.html');
    if (target !== rendererRoot && !target.startsWith(`${rendererRoot}${path.sep}`)) {
      return new Response('Not found', { status: 404 });
    }
    try {
      if ((await fs.stat(target)).isDirectory()) target = path.join(target, 'index.html');
    } catch {
      if (path.extname(requestedPath)) return new Response('Not found', { status: 404 });
      target = path.join(rendererRoot, 'index.html');
    }
    const response = await net.fetch(pathToFileURL(target).toString());
    const headers = new Headers(response.headers);
    headers.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' psstpsst-file: data: blob: https:; media-src 'self' psstpsst-file: blob: https:; connect-src 'self' data: blob: https: wss: http://localhost:* ws://localhost:*; font-src 'self' data:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'",
    );
    return new Response(response.body, { status: response.status, headers });
  });
}

function createWindow(): BrowserWindow {
  // The renderer may take a moment to report the effective theme; guess from
  // the OS scheme so the pre-paint frame and caption overlay start close.
  const initialChrome = nativeTheme.shouldUseDarkColors
    ? WINDOW_CHROME_COLORS.dark
    : WINDOW_CHROME_COLORS.light;
  const saved = windowStateStore?.state;
  const bounds = saved
    ? fitWindowBounds(saved.bounds, screen.getDisplayMatching(saved.bounds).workArea)
    : null;
  const window = new BrowserWindow({
    ...(bounds ?? { width: 960, height: 720 }),
    useContentSize: !bounds,
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    show: false,
    backgroundColor: initialChrome.background,
    // The themed title bar is renderer-drawn (`DesktopWindowFrame`): macOS
    // keeps inset traffic lights (centred on the strip), Windows/Linux get a
    // themed caption overlay.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: TRAFFIC_LIGHT_POSITION }
      : {
          titleBarOverlay: {
            color: initialChrome.titlebar,
            symbolColor: initialChrome.text,
            height: TITLEBAR_OVERLAY_HEIGHT,
          },
        }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
      additionalArguments: [
        `--psstpsst-proximity-available=${proximityService?.isAvailable() ? '1' : '0'}`,
      ],
    },
  });
  if (DEVELOPMENT_RENDERER_ORIGIN) {
    window.webContents.on('console-message', (details) => {
      if (details.level !== 'error') return;
      console.error(`[renderer] ${details.message} (${details.sourceId}:${details.lineNumber})`);
    });
    window.webContents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame) return;
        console.error(
          `[renderer] Failed to load ${validatedURL}: ${errorDescription} (${errorCode})`,
        );
      },
    );
    window.webContents.on('preload-error', (_event, preloadPath, error) => {
      console.error(`[renderer] Preload failed at ${preloadPath}:`, error);
    });
    window.webContents.on('render-process-gone', (_event, details) => {
      console.error(`[renderer] Process exited: ${details.reason} (${details.exitCode})`);
    });
  }
  window.once('ready-to-show', () => {
    if (saved?.maximized) window.maximize();
    window.show();
    const captureState = () => {
      if (!screenshotPreviewWindow.active) windowStateStore?.capture(window);
    };
    window.on('resize', captureState);
    window.on('move', captureState);
    window.on('maximize', captureState);
    window.on('unmaximize', captureState);
    window.on('leave-full-screen', captureState);
    captureState();
  });
  // Renderer-side notification gating needs both visibility and focus. In
  // particular, close-to-tray hides the window and must mark the user away.
  const sendWindowPresence = () => {
    if (window.webContents.isDestroyed()) return;
    window.webContents.send(IPC.windowFocusChanged, isWindowUserPresent(window));
  };
  window.on('focus', sendWindowPresence);
  window.on('blur', sendWindowPresence);
  window.on('show', sendWindowPresence);
  window.on('hide', sendWindowPresence);
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (EXTERNAL_SCHEMES.has(new URL(url).protocol)) void shell.openExternal(url);
    } catch {
      // Reject malformed and unknown links.
    }
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererLocation(url)) event.preventDefault();
  });
  window.on('close', (event) => {
    if (!screenshotPreviewWindow.active) windowStateStore?.capture(window);
    void windowStateStore?.flush();
    if (shuttingDown) return;
    event.preventDefault();
    window.hide();
  });
  window.once('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });
  return window;
}

async function openWindow(): Promise<void> {
  const session = (mainWindow = createWindow()).webContents.session;
  session.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    const trusted =
      webContents === mainWindow?.webContents &&
      isTrustedRendererLocation(requestingOrigin);
    return trusted && (permission === 'media' || permission === 'notifications');
  });
  session.setPermissionRequestHandler((webContents, permission, callback) => {
    const trusted = webContents === mainWindow?.webContents;
    callback(trusted && (permission === 'media' || permission === 'notifications'));
  });
  session.setDevicePermissionHandler(() => false);

  const ownerId = mainWindow.webContents.id;
  mainWindow.webContents.once('destroyed', () => {
    backgroundScheduler.abort();
    void databaseService?.cleanupOwner(ownerId);
    void fileService?.cleanupOwner(ownerId);
  });

  if (DEVELOPMENT_RENDERER_ORIGIN) {
    await mainWindow.loadURL(DEVELOPMENT_RENDERER_ORIGIN);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    await mainWindow.loadURL('app://renderer/');
  }
}

async function start(): Promise<void> {
  app.setAppUserModelId('chat.psstpsst.app');
  const userDataPath = app.getPath('userData');
  windowStateStore = new WindowStateStore(path.join(userDataPath, 'window-state.json'));
  await windowStateStore.load();
  backgroundConfigPath = path.join(userDataPath, 'background-task.json');
  fileService = new FileService(userDataPath);
  await fileService.initialize();
  secureStorageService = new SecureStorageService(userDataPath);
  proximityService = new ProximityService(
    ProximityService.executable(process.resourcesPath, path.resolve(__dirname, '..')),
    (name, value) => mainWindow?.webContents.send(IPC.proximityEvent, name, value),
  );
  await proximityService.initialize();
  noiseService = new NoiseService();
  process.env.PSSTPSST_PROXIMITY_AVAILABLE = proximityService.isAvailable() ? '1' : '0';
  databaseService = new DatabaseService(
    path.join(userDataPath, 'psstpsst.db'),
    (owner) => owner.send(IPC.databaseChanged, {}),
    (id) => webContents.fromId(id) ?? null,
  );
  appUpdateService = new DesktopAppUpdater({
    enabled: app.isPackaged,
    updater: autoUpdater,
    emitStatus: (status) => mainWindow?.webContents.send(IPC.appUpdateStatus, status),
    prepareToInstall: async () => {
      if (shuttingDown) throw new Error('Application shutdown is already in progress');
      shuttingDown = true;
      if (mainWindow && !screenshotPreviewWindow.active) windowStateStore?.capture(mainWindow);
      await windowStateStore?.flush();
      backgroundScheduler.stop();
      proximityService?.close();
      const results = await Promise.allSettled([
        databaseService?.close() ?? Promise.resolve(),
        noiseService?.close() ?? Promise.resolve(),
      ]);
      for (const result of results) {
        if (result.status === 'rejected') {
          console.error('[updates] Service cleanup failed before installation:', result.reason);
        }
      }
    },
  });
  registerIpcHandlers();
  await registerProtocols();
  const trayAssetName = process.platform === 'darwin' ? 'psstpsstTemplate.png' : 'psstpsst.png';
  const trayAssetPath = app.isPackaged
    ? path.join(process.resourcesPath, 'tray', trayAssetName)
    : path.join(__dirname, '../../assets/images/tray', trayAssetName);
  let trayIcon = nativeImage.createFromPath(trayAssetPath);
  if (process.platform === 'darwin') {
    trayIcon.setTemplateImage(true);
  } else {
    const size = process.platform === 'win32' ? 16 : 22;
    trayIcon = trayIcon.resize({ width: size, height: size });
  }
  trayBaseIcon = trayIcon;
  tray = new Tray(trayIcon);
  tray.setToolTip('PsstPsst');
  const trayMenu = Menu.buildFromTemplate([
    { label: 'Show PsstPsst', click: showMainWindow },
    { label: 'Quit', click: () => app.quit() },
  ]);
  configureTrayInteractions(tray, trayMenu, showMainWindow, process.platform);
  try {
    const config = JSON.parse(await fs.readFile(backgroundConfigPath, 'utf8')) as {
      minimumIntervalMinutes?: number;
    };
    if (typeof config.minimumIntervalMinutes === 'number') {
      scheduleBackgroundTask(config.minimumIntervalMinutes);
    }
  } catch {
    // No persisted background schedule yet.
  }
  await openWindow();
  if (app.isPackaged) {
    const updateTimer = setTimeout(() => void appUpdateService?.check(), UPDATE_CHECK_DELAY_MS);
    updateTimer.unref();
  }
}

app.enableSandbox();
if (process.defaultApp && process.argv[1]) {
  app.setAsDefaultProtocolClient(APP_SCHEME, process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient(APP_SCHEME);
}
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const deepLink = appDeepLinkFromArgs(argv);
    if (deepLink) deliverDeepLink(deepLink);
    showMainWindow();
  });
  const coldDeepLink = appDeepLinkFromArgs(process.argv);
  if (coldDeepLink) pendingDeepLink = coldDeepLink;
  void app
    .whenReady()
    .then(start)
    .catch((error) => {
      console.error('[startup] Failed to start Electron:', error);
      app.quit();
    });
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  deliverDeepLink(url);
  showMainWindow();
});

app.on('activate', () => {
  showMainWindow();
});

app.on('window-all-closed', () => {
  // The tray keeps the renderer alive so periodic polling can continue.
});

app.on('before-quit', (event) => {
  if (shuttingDown) return;
  event.preventDefault();
  shuttingDown = true;
  if (mainWindow && !screenshotPreviewWindow.active) windowStateStore?.capture(mainWindow);
  backgroundScheduler.stop();
  proximityService?.close();
  const closeServices = Promise.allSettled([
    windowStateStore?.flush() ?? Promise.resolve(),
    databaseService?.close() ?? Promise.resolve(),
    noiseService?.close() ?? Promise.resolve(),
  ]);
  void closeServices
    .catch(() => undefined)
    .finally(() => app.exit(0));
});
