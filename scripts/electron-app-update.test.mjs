import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { _electron as electron, expect } from '@playwright/test';

// Uses the production renderer and preload. The fixture replaces only native
// updater events and persistence; no release assets are downloaded or installed.
test('independent update window supports progress, background work, skip, retry and explicit installation', { timeout: 90000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'psst-update-ui-'));
  let application;
  try {
    await build({ stdin: { resolveDir: process.cwd(), contents: `
      import { app, BrowserWindow, ipcMain } from 'electron';
      import { createServer } from 'node:http';
      import { readFile } from 'node:fs/promises';
      import path from 'node:path';
      import { AppUpdateWindow } from './desktop/app-update-window';
      import { UpdatePreferences } from './desktop/update-preferences';
      import { DesktopAppUpdater } from './desktop/app-updater';
      import { PreviewAppUpdater } from './desktop/app-update-preview';
      import { EventEmitter } from 'node:events';
      import { IPC } from './desktop/ipc-channels';
      app.setPath('userData', ${JSON.stringify(path.join(dir, 'profile'))});
      app.whenReady().then(async () => {
        const calls = { downloads: 0, installs: 0 };
        const native = new EventEmitter();
        native.checkForUpdates = async () => null;
        native.downloadUpdate = async () => { calls.downloads++; };
        native.quitAndInstall = () => { calls.installs++; };
        const preferences = new UpdatePreferences(${JSON.stringify(path.join(dir, 'preferences.json'))});
        await preferences.load();
        let service, controller, mode = 'light', language = 'en', accent = 'blue';
        const root = ${JSON.stringify(path.resolve('desktop/dist/renderer'))};
        const server = createServer(async (request, response) => {
          const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
          const target = pathname === '/app-update-window' || pathname === '/' ? '/index.html' : pathname;
          const file = path.resolve(root, '.' + target);
          if (!file.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
          try {
            const body = await readFile(file);
            const type = file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream';
            response.writeHead(200, { 'content-type': type }); response.end(body);
          } catch { response.writeHead(404); response.end(); }
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const url = 'http://127.0.0.1:' + server.address().port + '/app-update-window';
        const create = () => {
          const window = new BrowserWindow({ width: 640, height: 440, useContentSize: true, show: false,
            webPreferences: { preload: ${JSON.stringify(path.resolve('desktop/dist/preload.js'))}, sandbox: true, contextIsolation: true, nodeIntegration: false,
              additionalArguments: ['--psstpsst-update-window=1', '--psstpsst-proximity-available=0'] } });
          window.on('focus', () => window.webContents.send(IPC.windowFocusChanged, true));
          return window;
        };
        controller = new AppUpdateWindow({ create, url, preferences, status: () => service.getStatus() });
        service = new DesktopAppUpdater({ enabled: true, updater: native, emitStatus: status => controller.onStatus(status), prepareToInstall: async () => {} });
        ipcMain.on(IPC.notificationSupported, event => { event.returnValue = false; });
        ipcMain.handle(IPC.appUpdateGetStatus, () => service.getStatus());
        ipcMain.handle(IPC.appUpdateDownload, () => service.download());
        ipcMain.handle(IPC.appUpdateInstall, () => service.install());
        ipcMain.handle(IPC.appUpdateCloseWindow, () => controller.close());
        ipcMain.handle(IPC.appUpdateSkipVersion, () => controller.skipVersion());
        ipcMain.handle(IPC.appUpdateOpenWindow, () => controller.open());
        ipcMain.handle(IPC.windowChromeSetTitle, () => {});
        ipcMain.handle(IPC.windowChromeSetTheme, () => {});
        ipcMain.handle(IPC.windowChromeGetAppearance, () => ({ preference: mode, accent }));
        ipcMain.handle(IPC.databaseExecute, (_event, _sql, params) => ({ rows:
          params[0] === 'theme.preference' ? [[mode]] : params[0] === 'theme.accent' ? [[accent]] : params[0] === 'language.preference' ? [[language]] : [] }));
        ipcMain.handle(IPC.legacyPreferenceRead, () => null);
        globalThis.updateFixture = {
          calls,
          preview: async () => {
            service = new DesktopAppUpdater({ enabled: true, preview: true, updater: new PreviewAppUpdater('26.10.6'),
              emitStatus: status => controller.onStatus(status), prepareToInstall: async () => {} });
            await service.check();
            return service.getStatus();
          },
          emit: (event, data) => native.emit(event, data),
          open: () => controller.open(),
          flush: () => preferences.flush(),
          windows: () => BrowserWindow.getAllWindows().length,
          mode: value => { mode = value; controller.setAppearance({ preference: mode, accent }); },
          accent: value => { accent = value; controller.setAppearance({ preference: mode, accent }); },
          language: value => { language = value; },
        };
      });
      app.on('window-all-closed', () => {});
    ` }, bundle: true, platform: 'node', format: 'cjs', external: ['electron', 'electron-updater'], outfile: path.join(dir, 'main.cjs') });
    application = await electron.launch({ colorScheme: null, args: [path.join(dir, 'main.cjs')], env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' } });
    await application.evaluate(() => new Promise(resolve => {
      const timer = setInterval(() => { if (globalThis.updateFixture) { clearInterval(timer); resolve(); } }, 10);
    }));
    const emit = (event, data) => application.evaluate((_electron, { event, data }) => { globalThis.updateFixture.emit(event, data); }, { event, data });
    const open = async (version = '99.0.0') => {
      const opening = application.waitForEvent('window');
      await emit('update-available', { version, releaseNotes: [
        { version, note: '<h3>Improvements</h3><ul><li>Improved message delivery.</li><li>More reliable desktop updates.</li></ul><script>globalThis.__releaseNoteScriptExecuted = true</script><img src="invalid:" onerror="globalThis.__releaseNoteScriptExecuted = true">' },
        { version: '98.9.0', note: '### Fixes\n- Earlier desktop fixes.' },
        { version: '98.8.0', note: null },
      ] });
      const page = await opening;
      await page.getByRole('button', { name: 'Download update', exact: true }).waitFor();
      return page;
    };
    const errors = [];
    application.on('window', page => {
      page.on('pageerror', error => errors.push(String(error)));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    });
    await emit('checking-for-update');
    assert.equal(await application.evaluate(() => globalThis.updateFixture.windows()), 0);
    await emit('update-not-available', {});
    assert.equal(await application.evaluate(() => globalThis.updateFixture.windows()), 0);
    let page = await open();
    assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
    assert.equal(await page.evaluate(() => window.opener === null), true);
    await application.evaluate(() => globalThis.updateFixture.open());
    assert.equal(await application.evaluate(() => globalThis.updateFixture.windows()), 1);
    const shots = process.env.PSSTPSST_UPDATE_SCREENSHOTS;
    if (shots) { await mkdir(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, 'available-light.png') }); }
    await page.getByRole('heading', { name: 'Version 98.8.0', exact: true }).waitFor({ state: 'attached' });
    assert.deepEqual(await page.getByRole('heading').allTextContents(), [
      'A new version of PsstPsst is available', 'Version 99.0.0', 'Version 98.9.0', 'Version 98.8.0',
    ]);
    assert.equal(await page.evaluate(() => globalThis.__releaseNoteScriptExecuted), undefined);
    assert.equal(await page.getByText(/<h3>|<li>|<script>/).count(), 0);
    await page.getByText('No release notes were provided for this version.', { exact: true }).waitFor({ state: 'attached' });
    const heading = page.getByRole('heading', { name: 'A new version of PsstPsst is available', exact: true });
    const lightText = await heading.evaluate(node => getComputedStyle(node).color);
    await application.evaluate(() => globalThis.updateFixture.mode('dark'));
    await expect.poll(() => heading.evaluate(node => getComputedStyle(node).color)).not.toBe(lightText);
    const button = page.getByRole('button', { name: 'Download update', exact: true });
    const blue = await button.evaluate(node => getComputedStyle(node).backgroundColor);
    await application.evaluate(() => globalThis.updateFixture.accent('purple'));
    await expect.poll(() => button.evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe(blue);
    if (shots) await page.screenshot({ path: path.join(shots, 'live-dark-purple.png') });
    await application.evaluate(() => { globalThis.updateFixture.accent('blue'); globalThis.updateFixture.mode('light'); });
    const closed = page.waitForEvent('close');
    await page.getByRole('button', { name: 'Skip this version', exact: true }).click(); await closed;
    await application.evaluate(() => globalThis.updateFixture.flush());
    await emit('update-available', { version: '99.0.0' });
    assert.equal(await application.evaluate(() => globalThis.updateFixture.windows()), 0);
    let opening = application.waitForEvent('window');
    await application.evaluate(() => { globalThis.updateFixture.mode('dark'); return globalThis.updateFixture.open(); });
    page = await opening;
    await page.getByRole('button', { name: 'Download update', exact: true }).waitFor();
    if (shots) await page.screenshot({ path: path.join(shots, 'available-dark.png') });
    await page.getByRole('button', { name: 'Download update', exact: true }).click();
    await emit('download-progress', { percent: 45, transferred: 45 * 1048576, total: 100 * 1048576, bytesPerSecond: 2 * 1048576 });
    await page.getByRole('progressbar').waitFor();
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '45');
    await page.getByText('2.0 MB/s', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Skip this version' }).count(), 0);
    if (shots) await page.screenshot({ path: path.join(shots, 'downloading-dark.png') });
    const backgroundClosed = page.waitForEvent('close');
    await page.getByRole('button', { name: 'Continue in background', exact: true }).click(); await backgroundClosed;
    await emit('download-progress', { percent: 100, total: 100, transferred: 100, bytesPerSecond: 0 });
    assert.equal(await application.evaluate(() => globalThis.updateFixture.windows()), 0);
    opening = application.waitForEvent('window');
    await application.evaluate(() => globalThis.updateFixture.open());
    page = await opening;
    await page.getByText('Download complete. Verifying and preparing the update…', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Restart and install' }).count(), 0);
    const preparingClosed = page.waitForEvent('close');
    await page.getByRole('button', { name: 'Continue in background', exact: true }).click(); await preparingClosed;
    opening = application.waitForEvent('window');
    await emit('update-downloaded', { version: '99.0.0' });
    page = await opening;
    await page.getByRole('button', { name: 'Restart and install', exact: true }).waitFor();
    assert.equal(await application.evaluate(() => globalThis.updateFixture.calls.installs), 0);
    if (shots) await page.screenshot({ path: path.join(shots, 'ready-dark.png') });
    await page.getByRole('button', { name: 'Restart and install', exact: true }).click();
    await page.getByText('Restarting to install', { exact: true }).waitFor();
    assert.equal(await application.evaluate(() => globalThis.updateFixture.calls.installs), 1);
    // Start another release to verify that transient failures expose a retry.
    await emit('update-available', { version: '99.1.0' });
    await page.getByRole('button', { name: 'Download update', exact: true }).click();
    await emit('error', new Error('offline'));
    await page.getByRole('button', { name: 'Retry', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.getByRole('progressbar').waitFor();
    assert.equal(await application.evaluate(() => globalThis.updateFixture.calls.downloads), 3);
    await emit('update-downloaded', { version: '99.1.0' });
    await page.getByRole('button', { name: 'Restart and install', exact: true }).waitFor();
    const deferred = page.waitForEvent('close');
    await page.getByRole('button', { name: 'Remind me later', exact: true }).click(); await deferred;
    await application.evaluate(() => globalThis.updateFixture.flush());
    opening = application.waitForEvent('window');
    await application.evaluate(() => { globalThis.updateFixture.language('zh'); globalThis.updateFixture.mode('light'); return globalThis.updateFixture.open(); });
    page = await opening;
    await page.getByRole('button', { name: '重启并安装', exact: true }).waitFor();
    await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(480, 360); });
    await expect(page.getByRole('button', { name: '重启并安装', exact: true })).toBeInViewport();
    await expect(page.getByRole('button', { name: '稍后提醒', exact: true })).toBeInViewport();
    if (shots) await page.screenshot({ path: path.join(shots, 'ready-zh-compact-light.png') });
    const closeReady = page.waitForEvent('close');
    await page.getByRole('button', { name: '稍后提醒', exact: true }).click(); await closeReady;
    opening = application.waitForEvent('window');
    const previewStatus = await application.evaluate(() => globalThis.updateFixture.preview());
    assert.equal(previewStatus.preview, true);
    page = await opening;
    await page.getByRole('button', { name: '下载更新', exact: true }).waitFor();
    await page.getByText('Update preview. Downloads and installation are simulated.', { exact: true }).waitFor();
    await page.getByText('Improvements', { exact: true }).first().waitFor();
    assert.equal(await page.getByRole('heading', { name: '版本 26.10.9', exact: true }).count(), 1);
    await page.getByRole('button', { name: '下载更新', exact: true }).click();
    await page.getByRole('progressbar').waitFor();
    await page.getByRole('button', { name: '重启并安装', exact: true }).waitFor();
    await page.getByRole('button', { name: '重启并安装', exact: true }).click();
    await page.getByRole('button', { name: '重启并安装', exact: true }).waitFor();
    assert.equal(page.isClosed(), false, 'simulated installation must keep the application running');
    assert.deepEqual(errors, [], 'the update leaf must not start account services or fail IPC');
  } finally {
    if (application) await application.close();
    await rm(dir, { recursive: true, force: true });
  }
});
