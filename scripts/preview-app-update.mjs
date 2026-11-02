import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { _electron as electron } from '@playwright/test';

// A persistent interactive preview uses the real renderer with simulated native
// update events and its own temporary profile. No release assets are installed.
const root = path.resolve(import.meta.dirname, '..');
const currentVersion = JSON.parse(await readFile(path.join(root, 'desktop/package.json'), 'utf8')).version;
const dir = await mkdtemp(path.join(tmpdir(), 'psst-update-preview-'));
let application;
try {
  try { await access(path.join(root, 'desktop/dist/renderer/renderer.js')); }
  catch { execFileSync('npm', ['run', 'electron:build:renderer'], { cwd: root, stdio: 'inherit' }); }
  await build({ entryPoints: [path.join(root, 'desktop/preload.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: path.join(dir, 'preload.cjs') });
  await build({ stdin: { resolveDir: root, contents: `
    import { app, BrowserWindow, ipcMain, Menu, dialog } from 'electron';
    import { createServer } from 'node:http';
    import { readFile } from 'node:fs/promises';
    import path from 'node:path';
    import { EventEmitter } from 'node:events';
    import { DesktopAppUpdater } from './desktop/app-updater';
    import { createPreviewUpdateInfo } from './desktop/app-update-preview';
    import { AppUpdateWindow } from './desktop/app-update-window';
    import { UpdatePreferences } from './desktop/update-preferences';
    import { IPC } from './desktop/ipc-channels';
    app.setName('PsstPsst Update Preview');
    app.setPath('userData', ${JSON.stringify(path.join(dir, 'profile'))});
    app.whenReady().then(async () => {
      let service, controller, revision = 0, mode = 'system', language = 'zh', accent = 'blue';
      let failDownload = false, failInstall = false;
      const release = () => createPreviewUpdateInfo(${JSON.stringify(currentVersion)}, revision);
      const native = new EventEmitter();
      native.checkForUpdates = async () => {
        native.emit('checking-for-update');
        await new Promise(resolve => setTimeout(resolve, 1200));
        native.emit('update-available', release());
        return null;
      };
      native.downloadUpdate = () => new Promise((resolve, reject) => {
        const info = release();
        let percent = 0;
        const timer = setInterval(() => {
          percent = Math.min(100, percent + 4);
          if (failDownload && percent >= 32) {
            clearInterval(timer); failDownload = false;
            Menu.getApplicationMenu().getMenuItemById('fail-download').checked = false;
            reject(new Error('Simulated network failure')); return;
          }
          native.emit('download-progress', { percent, total: 80 * 1048576, transferred: percent / 100 * 80 * 1048576, bytesPerSecond: 6.4 * 1048576 });
          if (percent === 100) {
            clearInterval(timer);
            setTimeout(() => { native.emit('update-downloaded', info); resolve([]); }, 1400);
          }
        }, 500);
      });
      native.quitAndInstall = () => {
        if (failInstall) { native.emit('error', new Error('Simulated installer failure')); return; }
        setTimeout(() => {
          void dialog.showMessageBox({ type: 'info', title: 'Update preview',
            message: 'Simulated installation complete',
            detail: 'No actual update was installed. Choose Preview > Offer next version to test again.' });
        }, 600);
      };
      const preferences = new UpdatePreferences(${JSON.stringify(path.join(dir, 'preferences.json'))});
      await preferences.load();
      const rendererRoot = ${JSON.stringify(path.join(root, 'desktop/dist/renderer'))};
      const server = createServer(async (request, response) => {
        try {
          const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
          const file = path.resolve(rendererRoot, '.' + (pathname === '/app-update-window' || pathname === '/' ? '/index.html' : pathname));
          if (!file.startsWith(rendererRoot + path.sep)) { response.writeHead(403); response.end(); return; }
          const body = await readFile(file);
          const type = file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream';
          response.writeHead(200, { 'content-type': type }); response.end(body);
        } catch { response.writeHead(404); response.end(); }
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const create = () => {
        const window = new BrowserWindow({ title: 'PsstPsst Update Preview', width: 640, height: 440, useContentSize: true,
          minWidth: 560, minHeight: 380, show: false, maximizable: false, fullscreenable: false,
          titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
          ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 12, y: 7 } } : { titleBarOverlay: { height: 40 } }),
          webPreferences: { preload: ${JSON.stringify(path.join(dir, 'preload.cjs'))}, sandbox: true, contextIsolation: true, nodeIntegration: false,
            additionalArguments: ['--psstpsst-update-window=1', '--psstpsst-proximity-available=0'] } });
        window.once('ready-to-show', () => { window.show(); window.focus(); app.focus({ steal: true }); });
        window.on('focus', () => window.webContents.send(IPC.windowFocusChanged, true));
        window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        return window;
      };
      controller = new AppUpdateWindow({ create, url: 'http://127.0.0.1:' + server.address().port + '/app-update-window',
        preferences, status: () => service.getStatus() });
      service = new DesktopAppUpdater({ enabled: true, preview: true, updater: native, emitStatus: status => controller.onStatus(status), prepareToInstall: async () => {} });
      ipcMain.on(IPC.notificationSupported, event => { event.returnValue = false; });
      for (const [channel, handler] of [
        [IPC.appUpdateGetStatus, () => service.getStatus()], [IPC.appUpdateDownload, () => service.download()],
        [IPC.appUpdateInstall, () => service.install()], [IPC.appUpdateCloseWindow, () => controller.close()],
        [IPC.appUpdateSkipVersion, () => controller.skipVersion()], [IPC.appUpdateOpenWindow, () => controller.open()],
        [IPC.legacyPreferenceRead, () => null],
      ]) ipcMain.handle(channel, handler);
      ipcMain.handle(IPC.windowChromeSetTitle, (event, title) => BrowserWindow.fromWebContents(event.sender).setTitle(title + ' · Update Preview'));
      ipcMain.handle(IPC.windowChromeGetAppearance, () => ({ preference: mode, accent }));
      ipcMain.handle(IPC.windowChromeSetTheme, (event, theme) => {
        const window = BrowserWindow.fromWebContents(event.sender); window.setBackgroundColor(theme.backgroundColor);
        if (process.platform !== 'darwin') window.setTitleBarOverlay({ color: theme.titlebarColor, symbolColor: theme.symbolColor, height: theme.titlebarHeight });
      });
      ipcMain.handle(IPC.databaseExecute, (_event, _sql, params) => ({ rows:
        params[0] === 'theme.preference' ? [[mode]] : params[0] === 'theme.accent' ? [[accent]] : params[0] === 'language.preference' ? [[language]] : [] }));
      const refresh = () => { controller.setAppearance({ preference: mode, accent }); for (const window of BrowserWindow.getAllWindows()) window.webContents.send(IPC.windowFocusChanged, true); };
      const guarded = action => () => { void Promise.resolve().then(action).catch(error => console.error('[preview]', error)); };
      Menu.setApplicationMenu(Menu.buildFromTemplate([
        { label: 'PsstPsst Update Preview', submenu: [{ role: 'quit', label: 'Quit preview' }] },
        { label: 'Preview', submenu: [
          { label: 'Open update window', accelerator: 'CmdOrCtrl+U', click: guarded(() => controller.open()) },
          { label: 'Check for updates', click: guarded(async () => { if (!controller.isOpen) await service.check(); await controller.open(); }) },
          { label: 'Automatic check (respects skipped version)', click: guarded(async () => { if (!controller.isOpen) await service.check(); controller.onStatus(service.getStatus()); }) },
          { label: 'Offer next version', click: () => { if (service.getStatus().state === 'downloading') return; revision++; native.emit('update-available', release()); } },
          { type: 'separator' },
          { id: 'fail-download', label: 'Fail next download', type: 'checkbox', click: item => { failDownload = item.checked; } },
          { label: 'Simulate installation failure', type: 'checkbox', click: item => { failInstall = item.checked; } },
          { type: 'separator' },
          { label: 'System appearance', click: () => { mode = 'system'; refresh(); } },
          { label: 'Light appearance', click: () => { mode = 'light'; refresh(); } },
          { label: 'Dark appearance', click: () => { mode = 'dark'; refresh(); } },
          { label: 'Blue accent', click: () => { accent = 'blue'; refresh(); } },
          { label: 'Purple accent', click: () => { accent = 'purple'; refresh(); } },
          { label: 'Chinese', click: () => { language = 'zh'; refresh(); } },
          { label: 'English', click: () => { language = 'en'; refresh(); } },
        ] },
        { role: 'editMenu' }, { role: 'windowMenu' },
      ]));
      native.emit('update-available', release());
      globalThis.updatePreview = { status: () => service.getStatus() };
    });
    app.on('window-all-closed', () => {});
  ` }, bundle: true, platform: 'node', format: 'cjs', external: ['electron', 'electron-updater'], outfile: path.join(dir, 'main.cjs') });
  application = await electron.launch({ colorScheme: null, args: [path.join(dir, 'main.cjs')], env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' } });
  const page = await application.firstWindow();
  await page.getByRole('button', { name: '下载更新', exact: true }).waitFor();
  const systemDark = await application.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors);
  const rendererDark = await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);
  if (systemDark !== rendererDark) throw new Error('Preview color scheme differs from the native system appearance');
  console.log(`System appearance: ${systemDark ? 'dark' : 'light'}; renderer matches.`);
  console.log('Update preview is ready. Use the Preview menu to reopen the window, offer another version, change appearance, or simulate failures.');
  await new Promise(resolve => { application.once('close', resolve); });
} finally {
  if (application) await application.close().catch(() => {});
  await rm(dir, { recursive: true, force: true });
}
