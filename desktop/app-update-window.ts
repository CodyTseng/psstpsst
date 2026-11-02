import type { BrowserWindow, WebContents } from 'electron';
import type { WindowAppearance } from '../src/platform/ports/window-chrome';
import type { AppUpdateStatus } from '../src/platform/ports/app-update';
import { IPC } from './ipc-channels';
import type { UpdatePreferences } from './update-preferences';

type Options = {
  create(): BrowserWindow;
  url: string;
  status(): AppUpdateStatus;
  preferences: UpdatePreferences;
};

/** One account-free update window; its lifetime never owns the download. */
export class AppUpdateWindow {
  private window: BrowserWindow | null = null;
  private opening: Promise<void> | null = null;
  private previousStatus: AppUpdateStatus = { state: 'idle' };

  constructor(private readonly options: Options) {}

  get isOpen(): boolean { return this.window !== null && !this.window.isDestroyed(); }

  owns(contents: WebContents): boolean {
    return this.window?.webContents === contents;
  }

  async open(manual = true): Promise<void> {
    const status = this.options.status();
    if (status.state === 'checking' || status.state === 'idle') return;
    if (this.window && !this.window.isDestroyed()) {
      if (manual) {
        if (this.window.isMinimized()) this.window.restore();
        this.window.show();
        this.window.focus();
      }
      return this.opening ?? undefined;
    }
    const window = this.options.create();
    this.window = window;
    window.on('close', () => {
      void this.options.preferences.defer(this.options.status()).catch(error => {
        console.warn('[updates] Unable to save reminder:', error);
      });
    });
    window.once('closed', () => { if (this.window === window) this.window = null; });
    const opening: Promise<void> = window.loadURL(this.options.url).then(() => {
      if (!window.isDestroyed()) this.sendStatus(this.options.status());
    }).catch(error => {
      if (!window.isDestroyed()) window.destroy();
      throw error;
    }).finally(() => { if (this.opening === opening) this.opening = null; });
    this.opening = opening;
    return opening;
  }

  setAppearance(appearance: WindowAppearance): void {
    if (this.window && !this.window.isDestroyed()) this.window.webContents.send(IPC.windowChromeAppearance, appearance);
  }

  close(): void { this.window?.close(); }

  async skipVersion(): Promise<void> {
    const status = this.options.status();
    if (status.state !== 'available') throw new Error('Only an undownloaded version can be skipped');
    await this.options.preferences.skip(status.version);
    // A concurrent download must not be dismissed as a skipped release.
    const current = this.options.status();
    if (current.state === 'available' && current.version === status.version) this.close();
  }

  onStatus(status: AppUpdateStatus): void {
    const previous = this.previousStatus;
    this.previousStatus = status;
    this.sendStatus(status);
    const newError = status.state === 'error' && (previous.state !== 'error' ||
      previous.version !== status.version || previous.phase !== status.phase);
    if (this.options.preferences.shouldPrompt(status) || newError) {
      void this.open(false).catch(error => console.warn('[updates] Unable to open update window:', error));
    }
  }

  private sendStatus(status: AppUpdateStatus): void {
    if (!this.window || this.window.isDestroyed()) return;
    this.window.webContents.send(IPC.appUpdateStatus, status);
    this.window.setProgressBar(status.state === 'downloading' ? status.percent / 100 : -1);
  }
}
