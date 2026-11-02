import { EventEmitter } from 'node:events';
import type { UpdateInfo } from 'electron-updater';
import type { DesktopAutoUpdater } from './app-updater';

/** Stable, deliberately untranslated fixture shared by every preview surface. */
export function createPreviewUpdateInfo(currentVersion: string, revision = 0): UpdateInfo {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(currentVersion);
  const [major, minor, patch] = match ? match.slice(1).map(Number) : [99, 0, 0];
  const version = (offset: number) => `${major}.${minor}.${patch + revision + offset}`;
  return {
    version: version(3), files: [], path: '', sha512: '', releaseDate: '2026-01-01T00:00:00.000Z',
    releaseNotes: [
      { version: version(3), note: '<h3>Improvements</h3><ul><li>Desktop updates can download in the background.</li><li>More reliable message delivery when switching networks.</li></ul><h3>Fixes</h3><ul><li>Fixed stale connection status in some cases.</li></ul>' },
      { version: version(2), note: '### Fixes\n- Restored saved window sizes more reliably.\n- Improved text contrast in dark mode.' },
      { version: version(1), note: '### Improvements\n- Faster loading for large conversations.' },
    ],
  };
}

/** Development adapter: emits updater events without network, files, or process shutdown. */
export class PreviewAppUpdater extends EventEmitter implements DesktopAutoUpdater {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  autoRunAppAfterInstall = false;
  allowPrerelease = false;
  allowDowngrade = false;
  disableWebInstaller = true;
  fullChangelog = true;
  private readonly info: UpdateInfo;

  constructor(currentVersion: string) {
    super();
    this.info = createPreviewUpdateInfo(currentVersion);
  }

  async checkForUpdates(): Promise<null> {
    this.emit('checking-for-update');
    this.emit('update-available', this.info);
    return null;
  }

  downloadUpdate(): Promise<string[]> {
    return new Promise(resolve => {
      let percent = 0;
      const total = 80 * 1024 * 1024;
      const timer = setInterval(() => {
        percent = Math.min(100, percent + 5);
        this.emit('download-progress', { percent, total, transferred: percent / 100 * total, bytesPerSecond: total / 8 });
        if (percent === 100) {
          clearInterval(timer);
          setTimeout(() => { this.emit('update-downloaded', this.info); resolve([]); }, 800);
        }
      }, 400);
    });
  }

  quitAndInstall(): void {
    // Return to the ready state so repeated debugging never closes the real app.
    setTimeout(() => this.emit('update-downloaded', this.info), 600);
  }
}
