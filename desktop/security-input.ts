import { BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const SECURITY_INPUT_CHANNEL = 'psstpsst:trusted-input';
export type SecurityInputConfig = {
  title: string; message: string; confirm: string; cancel: string; error: string;
  input?: string; confirmation?: string; numeric?: boolean; details?: string;
};
type Pending = { window: BrowserWindow; owner: BrowserWindow; config: SecurityInputConfig; busy: boolean;
  submit(value: string, confirmation: string, active: () => boolean): Promise<boolean>; finish(value: boolean): void };

/** A separate, sandboxed document owns credential inputs. Host renderers receive only outcomes. */
export class SecurityInputController {
  private pending = new Map<number, Pending>();
  private tail: Promise<unknown> = Promise.resolve();
  constructor() {
    ipcMain.handle(SECURITY_INPUT_CHANNEL, async (event, action, payload) => {
      const pending = this.pending.get(event.sender.id);
      if (!pending || event.senderFrame !== event.sender.mainFrame || pending.window.isDestroyed()) throw new Error('Untrusted security input');
      if (action === 'config') return pending.config;
      if (action === 'cancel') { pending.finish(false); return false; }
      if (action !== 'submit' || pending.busy || !payload || typeof payload !== 'object'
        || typeof payload.value !== 'string' || payload.value.length > 256 || typeof payload.confirmation !== 'string' || payload.confirmation.length > 256) return false;
      pending.busy = true;
      try {
        if (pending.config.confirmation && payload.value !== payload.confirmation) return false;
        const result = await pending.submit(payload.value, payload.confirmation, () => this.pending.get(event.sender.id) === pending && !pending.window.isDestroyed() && !pending.owner.isDestroyed());
        if (result) pending.finish(true);
        return result;
      } catch { return false; }
      finally { pending.busy = false; }
    });
  }
  prompt(owner: BrowserWindow, config: SecurityInputConfig, submit: Pending['submit']): Promise<boolean> {
    const work = this.tail.then(() => this.open(owner, config, submit));
    this.tail = work.catch(() => {});
    return work;
  }
  private open(owner: BrowserWindow, config: SecurityInputConfig, submit: Pending['submit']): Promise<boolean> {
    if (owner.isDestroyed()) return Promise.resolve(false);
    return new Promise(resolve => {
      const window = new BrowserWindow({ parent: owner, modal: true, show: false, width: 460, height: 520,
        title: config.title, autoHideMenuBar: true, minimizable: false, maximizable: false,
        webPreferences: { preload: path.join(__dirname, 'security-input-preload.js'),
          sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, devTools: false,
          partition: `security-${randomUUID()}` } });
      const contentsId = window.webContents.id;
      let settled = false;
      const finish = (result: boolean) => {
        if (settled) return;
        settled = true; this.pending.delete(contentsId);
        owner.removeListener('closed', onOwnerClosed);
        if (!window.isDestroyed()) window.destroy();
        resolve(result);
      };
      const onOwnerClosed = () => finish(false);
      owner.once('closed', onOwnerClosed);
      this.pending.set(window.webContents.id, { window, owner, config, busy: false, submit, finish });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', event => event.preventDefault());
      window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      window.webContents.session.setPermissionCheckHandler(() => false);
      window.on('closed', () => finish(false));
      window.once('ready-to-show', () => { if (!window.isDestroyed()) window.show(); });
      void window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'nonce-psst-security\'; form-action \'none\'; base-uri \'none\'"></head><body></body></html>')).catch(() => finish(false));
    });
  }
}
