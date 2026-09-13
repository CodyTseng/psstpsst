import type { AppUpdater, ProgressInfo, UpdateInfo } from 'electron-updater';

import type { AppUpdateStatus } from '../src/platform/ports/app-update';

export type DesktopAutoUpdater = Pick<
  AppUpdater,
  | 'allowDowngrade'
  | 'allowPrerelease'
  | 'autoDownload'
  | 'autoInstallOnAppQuit'
  | 'autoRunAppAfterInstall'
  | 'disableWebInstaller'
  | 'checkForUpdates'
  | 'downloadUpdate'
  | 'quitAndInstall'
  | 'on'
>;

export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

type Options = {
  lastCheckedAt?: number;
  now?: () => number;
  saveLastCheckedAt?: (timestamp: number) => Promise<void>;
  enabled: boolean;
  updater: DesktopAutoUpdater;
  emitStatus: (status: AppUpdateStatus) => void;
  prepareToInstall: () => Promise<void>;
};

/**
 * Owns the packaged Electron update state machine. Downloading and installing
 * are deliberately separate renderer actions so neither can happen without a
 * user's explicit confirmation.
 */
export class DesktopAppUpdater {
  private status: AppUpdateStatus = { state: 'idle' };
  private checking: Promise<void> | null = null;
  private downloading: Promise<void> | null = null;
  private availableVersion: string | null = null;
  private lastCheckedAt: number;

  constructor(private readonly options: Options) {
    this.lastCheckedAt = options.lastCheckedAt ?? 0;
    const { updater } = options;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.autoRunAppAfterInstall = true;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.disableWebInstaller = true;

    updater.on('checking-for-update', () => this.setStatus({ state: 'checking' }));
    updater.on('update-available', (info: UpdateInfo) => {
      const version = this.safeVersion(info.version);
      this.availableVersion = version;
      this.setStatus({ state: 'available', version });
    });
    updater.on('update-not-available', () => {
      this.availableVersion = null;
      this.setStatus({ state: 'idle' });
    });
    updater.on('download-progress', (progress: ProgressInfo) => {
      if (!this.availableVersion) return;
      this.setStatus({
        state: 'downloading',
        version: this.availableVersion,
        percent: Math.min(100, Math.max(0, progress.percent)),
      });
    });
    updater.on('update-downloaded', (info: UpdateInfo) => {
      const version = this.safeVersion(info.version);
      this.availableVersion = version;
      this.setStatus({ state: 'downloaded', version });
    });
    updater.on('update-cancelled', () => this.restoreAvailableStatus());
    updater.on('error', (error: Error) => {
      console.error('[updates] Electron updater error:', error);
      if (this.status.state === 'downloading') this.restoreAvailableStatus();
      else if (this.status.state === 'checking') this.setStatus({ state: 'idle' });
    });
  }

  getStatus(): AppUpdateStatus {
    return this.status;
  }

  async checkIfDue(): Promise<void> {
    const now = (this.options.now ?? Date.now)();
    if (
      this.lastCheckedAt > 0 && now >= this.lastCheckedAt &&
      now - this.lastCheckedAt < UPDATE_CHECK_INTERVAL_MS
    ) return;
    await this.check().catch(() => {});
  }

  check(): Promise<void> {
    if (!this.options.enabled || this.status.state === 'downloaded' ||
        this.status.state === 'downloading') return Promise.resolve();
    if (this.checking) return this.checking;

    this.lastCheckedAt = (this.options.now ?? Date.now)();
    const timestamp = this.lastCheckedAt;
    this.setStatus({ state: 'checking' });
    const task = Promise.resolve().then(async () => {
      await this.options.saveLastCheckedAt?.(timestamp).catch((error) => {
        console.warn('[updates] Unable to save update check time:', error);
      });
      return this.options.updater.checkForUpdates();
    })
      .then(() => undefined)
      .catch((error) => {
        console.warn('[updates] Update check failed:', error);
        if (this.status.state === 'checking') this.setStatus({ state: 'idle' });
        throw error;
      })
      .finally(() => {
        if (this.checking === task) this.checking = null;
      });
    this.checking = task;
    return task;
  }

  download(): Promise<void> {
    if (!this.options.enabled) return Promise.reject(new Error('Application updates are unavailable'));
    if (this.status.state === 'downloaded') return Promise.resolve();
    if (this.downloading) return this.downloading;
    if (this.status.state !== 'available' || !this.availableVersion) {
      return Promise.reject(new Error('No application update is available'));
    }

    const version = this.availableVersion;
    this.setStatus({ state: 'downloading', version, percent: 0 });
    const task = this.options.updater
      .downloadUpdate()
      .then(() => undefined)
      .catch((error) => {
        this.restoreAvailableStatus();
        throw new Error('Unable to download the application update', { cause: error });
      })
      .finally(() => {
        if (this.downloading === task) this.downloading = null;
      });
    this.downloading = task;
    return task;
  }

  async install(): Promise<void> {
    if (!this.options.enabled || this.status.state !== 'downloaded') {
      throw new Error('No downloaded application update is ready to install');
    }
    await this.options.prepareToInstall();
    this.options.updater.quitAndInstall(false, true);
  }

  private safeVersion(value: string): string {
    return typeof value === 'string' && value.length <= 64 ? value : 'unknown';
  }

  private restoreAvailableStatus(): void {
    if (this.availableVersion) {
      this.setStatus({ state: 'available', version: this.availableVersion });
    } else {
      this.setStatus({ state: 'idle' });
    }
  }

  private setStatus(status: AppUpdateStatus): void {
    this.status = status;
    this.options.emitStatus(status);
  }
}
