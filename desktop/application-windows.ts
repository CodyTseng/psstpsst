import { BrowserWindow, ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import type { ApplicationWindowLaunch, ApplicationWindowAction, ApplicationSigningChange } from '../src/platform/ports/application-window';
import { IPC } from './ipc-channels';

/** Only host renderers enter this registry; application WebContentsViews never do. */
export class ApplicationWindows {
  private hosts = new Map<BrowserWindow, ApplicationWindowLaunch>();
  constructor(private options: { create: () => BrowserWindow; parent: () => BrowserWindow | null; url: () => string;
    cleanup: (ownerId: number) => void; trusted: (event: IpcMainInvokeEvent) => boolean }) {}
  owns(sender: WebContents) { return this.windows().some(window => window.webContents === sender); }
  windows() { return [...this.hosts.keys()].filter(window => !window.isDestroyed()); }
  private host(sender: WebContents) { return this.windows().find(window => window.webContents === sender); }
  register() {
    const handle = (channel: string, callback: (event: IpcMainInvokeEvent, ...args: any[]) => unknown) => ipcMain.handle(channel, (event, ...args) => {
      if (!this.options.trusted(event)) throw new Error('untrusted-application-host');
      return callback(event, ...args);
    });
    handle(IPC.applicationWindowOpen, async (_event, launch: ApplicationWindowLaunch) => {
      if (!launch || !/^[a-f0-9]{64}$/.test(launch.accountPubkey) || typeof launch.address !== 'string' || launch.address.length > 8192 ||
        JSON.stringify(launch).length > 512 * 1024 || this.hosts.size >= 8) throw new Error('invalid-application-window');
      const window = this.options.create();
      this.hosts.set(window, structuredClone(launch));
      // The host owns its native title; document/router titles never replace it.
      window.webContents.on('page-title-updated', event => event.preventDefault());
      const ownerId = window.webContents.id;
      window.once('closed', () => { this.hosts.delete(window); this.options.cleanup(ownerId); });
      try { await window.loadURL(this.options.url()); }
      catch (error) { window.destroy(); throw error; }
    });
    handle(IPC.applicationWindowLaunch, event => {
      const window = this.host(event.sender);
      return window ? this.hosts.get(window) : null;
    });
    handle(IPC.applicationWindowClose, event => { this.host(event.sender)?.close(); });
    handle(IPC.applicationWindowCloseAll, (event, account?: string) => {
      if (event.sender !== this.options.parent()?.webContents) throw new Error('untrusted-window-owner');
      for (const [window, launch] of this.hosts) if (!account || launch.accountPubkey === account) window.close();
    });
    handle(IPC.applicationWindowAction, (event, action: ApplicationWindowAction) => {
      const window = this.host(event.sender), launch = window && this.hosts.get(window);
      if (!launch || !action || JSON.stringify(action).length > 16000) throw new Error('invalid-window-action');
      if (action.type === 'visited') {
        if (action.accountPubkey !== launch.accountPubkey || typeof action.key !== 'string' || action.key.length > 8192) throw new Error('invalid-window-action');
        this.options.parent()?.webContents.send(IPC.applicationWindowAction, action);
        return;
      }
      if (action.type === 'profile' ? !/^[a-f0-9]{64}$/.test(action.pubkey) :
        action.type !== 'share' || action.accountPubkey !== launch.accountPubkey || typeof action.title !== 'string' || typeof action.address !== 'string') throw new Error('invalid-window-action');
      const parent = this.options.parent();
      if (!parent || parent.isDestroyed()) throw new Error('window-unavailable');
      parent.show(); parent.focus(); parent.webContents.send(IPC.applicationWindowAction, action);
    });
    handle(IPC.applicationSigningChange, (event, change: ApplicationSigningChange) => {
      if (!change || !/^[a-f0-9]{64}$/.test(change.accountPubkey) || typeof change.sourceId !== 'string' || change.sourceId.length > 8192 ||
        (change.key !== undefined && (typeof change.key !== 'string' || change.key.length > 4096))) throw new Error('invalid-signing-change');
      for (const window of [this.options.parent(), ...this.windows()]) if (window && !window.isDestroyed() && window.webContents !== event.sender)
        window.webContents.send(IPC.applicationSigningChange, change);
    });
  }
}
