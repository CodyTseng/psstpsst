import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { AppUpdateStatus } from '../../src/platform/ports/app-update';
import { AppUpdateWindow } from '../app-update-window';
import { UpdatePreferences } from '../update-preferences';
import { UPDATE_CHECK_INTERVAL_MS } from '../app-updater';

class FakeWindow extends EventEmitter {
  destroyed = false;
  webContents = { send: jest.fn() };
  isDestroyed = () => this.destroyed;
  isMinimized = () => false;
  restore = jest.fn(); show = jest.fn(); focus = jest.fn();
  setProgressBar = jest.fn();
  loadURL = jest.fn(async () => {});
  destroy() { this.destroyed = true; this.emit('closed'); }
  close() { this.emit('close'); this.destroy(); }
}
let directory: string;
beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'psstpsst-updates-')); });
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

function fixture() {
  let status: AppUpdateStatus = { state: 'idle' };
  let now = UPDATE_CHECK_INTERVAL_MS;
  const file = path.join(directory, 'preferences.json');
  const preferences = new UpdatePreferences(file, () => now);
  const windows: FakeWindow[] = [];
  const createWindow = jest.fn(() => { const window = new FakeWindow(); windows.push(window); return window as unknown as BrowserWindow; });
  const controller = new AppUpdateWindow({ create: createWindow, url: 'app://renderer/app-update-window', status: () => status, preferences });
  return { controller, preferences, windows, createWindow, file,
    set: (next: AppUpdateStatus) => { status = next; controller.onStatus(next); },
    advance: () => { now += UPDATE_CHECK_INTERVAL_MS; },
  };
}

it('never creates a window for checking or an up-to-date result', async () => {
  const f = fixture();
  f.set({ state: 'checking' }); await f.controller.open();
  f.set({ state: 'idle' }); await f.controller.open();
  expect(f.createWindow).not.toHaveBeenCalled();
});
it('opens one independent window and focuses it on manual reentry', async () => {
  const f = fixture();
  f.set({ state: 'available', version: '1.2.0' });
  await Promise.all([f.controller.open(), f.controller.open()]);
  expect(f.createWindow).toHaveBeenCalledTimes(1);
  expect(f.windows[0].focus).toHaveBeenCalledTimes(2);
  expect(f.controller.owns(f.windows[0].webContents as never)).toBe(true);
});
it('keeps a closed download retrievable and reopens when ready without installing', async () => {
  const f = fixture();
  f.set({ state: 'available', version: '1.2.0' }); await f.controller.open();
  f.set({ state: 'downloading', version: '1.2.0', percent: 45 });
  expect(f.windows[0].setProgressBar).toHaveBeenLastCalledWith(0.45);
  f.controller.close();
  f.set({ state: 'downloading', version: '1.2.0', percent: 80 });
  expect(f.windows).toHaveLength(1);
  await f.controller.open();
  expect(f.windows).toHaveLength(2);
  f.controller.close();
  f.set({ state: 'downloaded', version: '1.2.0' });
  expect(f.windows).toHaveLength(3);
  await f.controller.open();
  f.controller.close(); await f.preferences.flush();
});
it('persists skipping one version and permits manual reentry and a newer version', async () => {
  const f = fixture();
  f.set({ state: 'available', version: '1.2.0' }); await f.controller.open();
  await f.controller.skipVersion(); await f.preferences.flush();
  const restored = new UpdatePreferences(f.file); await restored.load();
  expect(restored.shouldPrompt({ state: 'available', version: '1.2.0' })).toBe(false);
  f.set({ state: 'available', version: '1.2.0' });
  expect(f.windows).toHaveLength(1);
  await f.controller.open(); expect(f.windows).toHaveLength(2);
  f.controller.close(); await f.preferences.flush();
  f.set({ state: 'available', version: '1.3.0' }); expect(f.windows).toHaveLength(3);
});
it('persists Later across restarts, reminds after 24h, and separates download and install decisions', async () => {
  const f = fixture();
  f.set({ state: 'available', version: '1.2.0' }); await f.controller.open();
  f.controller.close(); await f.preferences.flush();
  const restored = new UpdatePreferences(f.file, () => UPDATE_CHECK_INTERVAL_MS); await restored.load();
  expect(restored.shouldPrompt({ state: 'available', version: '1.2.0' })).toBe(false);
  f.set({ state: 'available', version: '1.2.0' }); expect(f.windows).toHaveLength(1);
  expect(restored.shouldPrompt({ state: 'downloaded', version: '1.2.0' })).toBe(true);
  f.advance(); f.set({ state: 'available', version: '1.2.0' }); expect(f.windows).toHaveLength(2);
});
it('rejects skipping an active download', async () => {
  const f = fixture(); f.set({ state: 'downloading', version: '1.2.0', percent: 1 });
  await expect(f.controller.skipVersion()).rejects.toThrow('undownloaded');
});
it('survives missing and invalid preference files', async () => {
  const f = fixture(); await f.preferences.load();
  await fs.writeFile(f.file, JSON.stringify({ skippedVersion: {}, reminder: { version: '1.2.0', after: -1, state: 'available' } }));
  await f.preferences.load();
  expect(f.preferences.shouldPrompt({ state: 'available', version: '1.2.0' })).toBe(true);
});
it('does not report a persisted skip when writing preferences fails', async () => {
  const preferences = new UpdatePreferences(path.join(directory, 'missing', 'preferences.json'));
  await expect(preferences.skip('1.2.0')).rejects.toThrow();
  expect(preferences.shouldPrompt({ state: 'available', version: '1.2.0' })).toBe(true);
});


it('does not reopen a dismissed error just because the main window regains focus', async () => {
  const f = fixture();
  f.set({ state: 'error', version: '1.2.0', phase: 'download' });
  await f.controller.open();
  f.controller.close();
  f.set({ state: 'error', version: '1.2.0', phase: 'download' });
  expect(f.windows).toHaveLength(1);
  await f.controller.open();
  expect(f.windows).toHaveLength(2);
});

it('restores the last committed choice if all queued persistence attempts fail', async () => {
  const preferences = new UpdatePreferences(path.join(directory, 'missing', 'preferences.json'));
  await Promise.allSettled([
    preferences.skip('1.2.0'),
    preferences.defer({ state: 'available', version: '1.2.0' }),
  ]);
  expect(preferences.shouldPrompt({ state: 'available', version: '1.2.0' })).toBe(true);
});


it('delivers live appearance to the existing update window without opening another one', async () => {
  const f = fixture();
  f.set({ state: 'available', version: '1.2.0' });
  await f.controller.open();
  f.controller.setAppearance({ preference: 'dark', accent: 'purple' });
  expect(f.windows[0].webContents.send).toHaveBeenLastCalledWith('psstpsst:window-chrome:appearance', { preference: 'dark', accent: 'purple' });
  expect(f.windows).toHaveLength(1);
});
