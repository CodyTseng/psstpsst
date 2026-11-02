import type { AppUpdater, ProgressInfo, UpdateInfo } from 'electron-updater';

import type { AppUpdateRelease, AppUpdateStatus } from '../src/platform/ports/app-update';

export type DesktopAutoUpdater = Pick<
  AppUpdater,
  | 'allowDowngrade'
  | 'allowPrerelease'
  | 'autoDownload'
  | 'autoInstallOnAppQuit'
  | 'autoRunAppAfterInstall'
  | 'disableWebInstaller'
  | 'fullChangelog'
  | 'checkForUpdates'
  | 'downloadUpdate'
  | 'quitAndInstall'
> & {
  /** Listener registration does not depend on the native updater's fluent return type. */
  on(event: string, listener: (...args: any[]) => void): unknown;
};

export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

type Options = {
  preview?: boolean;
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
  private release: AppUpdateRelease | null = null;
  private lastCheckedAt: number;
  private preparedToInstall = false;

  constructor(private readonly options: Options) {
    this.lastCheckedAt = options.lastCheckedAt ?? 0;
    const { updater } = options;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.autoRunAppAfterInstall = true;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.disableWebInstaller = true;
    updater.fullChangelog = true;

    updater.on('checking-for-update', () => this.setStatus({ state: 'checking' }));
    updater.on('update-available', (info: UpdateInfo) => {
      this.release = this.readRelease(info);
      this.setStatus({ state: 'available', ...this.release });
    });
    updater.on('update-not-available', () => {
      this.release = null;
      this.setStatus({ state: 'idle' });
    });
    updater.on('download-progress', (progress: ProgressInfo) => {
      if (!this.release || this.status.state !== 'downloading') return;
      const count = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
      this.setStatus({
        state: 'downloading', ...this.release,
        percent: Math.min(100, count(progress.percent)),
        transferred: count(progress.transferred), total: count(progress.total),
        bytesPerSecond: count(progress.bytesPerSecond),
      });
    });
    updater.on('update-downloaded', (info: UpdateInfo) => {
      this.release = this.readRelease(info);
      this.setStatus({ state: 'downloaded', ...this.release });
    });
    updater.on('update-cancelled', () => this.restoreAvailableStatus());
    updater.on('error', (error: Error) => {
      console.error('[updates] Electron updater error:', error);
      if (this.status.state === 'downloading') this.fail('download');
      else if (this.status.state === 'installing') this.fail('install');
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
        this.status.state === 'downloading' || this.status.state === 'installing' ||
        (this.status.state === 'error' && this.status.phase === 'install')) return Promise.resolve();
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
    if ((this.status.state !== 'available' && !(this.status.state === 'error' && this.status.phase === 'download')) || !this.release) {
      return Promise.reject(new Error('No application update is available'));
    }

    this.setStatus({ state: 'downloading', ...this.release, percent: 0 });
    const task = this.options.updater
      .downloadUpdate()
      .then(() => undefined)
      .catch((error) => {
        this.fail('download');
        throw new Error('Unable to download the application update', { cause: error });
      })
      .finally(() => {
        if (this.downloading === task) this.downloading = null;
      });
    this.downloading = task;
    return task;
  }

  async install(): Promise<void> {
    if (!this.options.enabled || (this.status.state !== 'downloaded' && !(this.status.state === 'error' && this.status.phase === 'install'))) {
      throw new Error('No downloaded application update is ready to install');
    }
    this.setStatus({ state: 'installing', ...this.release! });
    try {
      if (!this.preparedToInstall) {
        await this.options.prepareToInstall();
        this.preparedToInstall = true;
      }
      this.options.updater.quitAndInstall(false, true);
    } catch (error) {
      this.fail('install');
      throw error;
    }
  }

  private readRelease(info: UpdateInfo): AppUpdateRelease {
    const version = typeof info.version === 'string' && info.version.length <= 64 ? info.version : 'unknown';
    const mode = this.options.preview ? { preview: true as const } : {};
    if (Array.isArray(info.releaseNotes) && info.releaseNotes.length > 0) {
      // The GitHub provider selects current < version <= target and sorts with
      // semver. Preserve that order and each version boundary across IPC.
      let remaining = 128 * 1024;
      const changelog = info.releaseNotes.map(entry => {
        const source = typeof entry.note === 'string' ? entry.note : '';
        const note = source.slice(0, Math.min(remaining, 32_768));
        remaining -= note.length;
        return { version: entry.version, note, ...(note.length < source.length ? { truncated: true } : {}) };
      });
      return { version, ...mode, changelog };
    }
    const previous = this.release?.version === version ? this.release : null;
    if (previous?.changelog) return { version, ...mode, changelog: previous.changelog };
    const releaseNotes = typeof info.releaseNotes === 'string' && info.releaseNotes.trim()
      ? info.releaseNotes.slice(0, 32_768) : previous?.releaseNotes;
    return releaseNotes ? { version, ...mode, releaseNotes } : { version, ...mode };
  }

  private fail(phase: 'download' | 'install'): void {
    if (this.release) this.setStatus({ state: 'error', phase, ...this.release });
  }

  private restoreAvailableStatus(): void {
    if (this.release) {
      this.setStatus({ state: 'available', ...this.release });
    } else {
      this.setStatus({ state: 'idle' });
    }
  }

  private setStatus(status: AppUpdateStatus): void {
    this.status = status;
    this.options.emitStatus(status);
  }
}
