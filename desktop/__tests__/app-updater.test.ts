import { EventEmitter } from 'node:events';

import {
  DesktopAppUpdater,
  type DesktopAutoUpdater,
  UPDATE_CHECK_INTERVAL_MS,
} from '../app-updater';

class FakeAutoUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  autoRunAppAfterInstall = false;
  allowPrerelease = true;
  allowDowngrade = true;
  disableWebInstaller = false;
  checkForUpdates = jest.fn(async () => null);
  downloadUpdate = jest.fn(async () => ['/tmp/update']);
  quitAndInstall = jest.fn();
}

function createUpdater(enabled = true, timing: { lastCheckedAt?: number; now?: () => number; saveLastCheckedAt?: (time: number) => Promise<void> } = {}) {
  const native = new FakeAutoUpdater();
  const emitStatus = jest.fn();
  const prepareToInstall = jest.fn(async () => {});
  const service = new DesktopAppUpdater({
    ...timing,
    enabled,
    updater: native as unknown as DesktopAutoUpdater,
    emitStatus,
    prepareToInstall,
  });
  return { emitStatus, native, prepareToInstall, service };
}

describe('DesktopAppUpdater', () => {
  it('disables every automatic or unsafe update path', () => {
    const { native } = createUpdater();

    expect(native.autoDownload).toBe(false);
    expect(native.autoInstallOnAppQuit).toBe(false);
    expect(native.autoRunAppAfterInstall).toBe(true);
    expect(native.allowPrerelease).toBe(false);
    expect(native.allowDowngrade).toBe(false);
    expect(native.disableWebInstaller).toBe(true);
  });

  it('does not check for updates in an unpackaged development build', async () => {
    const { native, service } = createUpdater(false);

    await service.check();

    expect(native.checkForUpdates).not.toHaveBeenCalled();
    expect(service.getStatus()).toEqual({ state: 'idle' });
  });

  it('waits for explicit download consent and publishes bounded progress', async () => {
    const { emitStatus, native, service } = createUpdater();

    native.emit('update-available', { version: '1.2.0' });
    expect(native.downloadUpdate).not.toHaveBeenCalled();
    expect(service.getStatus()).toEqual({ state: 'available', version: '1.2.0' });

    const download = service.download();
    native.emit('download-progress', { percent: 140 });
    native.emit('update-downloaded', { version: '1.2.0' });
    await download;

    expect(native.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(emitStatus).toHaveBeenCalledWith({
      state: 'downloading',
      version: '1.2.0',
      percent: 100,
    });
    expect(service.getStatus()).toEqual({ state: 'downloaded', version: '1.2.0' });
  });

  it('installs only after a download and prepares services before quitting', async () => {
    const { native, prepareToInstall, service } = createUpdater();

    await expect(service.install()).rejects.toThrow('No downloaded application update');
    native.emit('update-downloaded', { version: '1.2.0' });

    await service.install();

    expect(prepareToInstall).toHaveBeenCalledTimes(1);
    expect(native.quitAndInstall).toHaveBeenCalledWith(false, true);
    expect(prepareToInstall.mock.invocationCallOrder[0]).toBeLessThan(
      native.quitAndInstall.mock.invocationCallOrder[0],
    );
  });

  it('restores the available state after a failed download', async () => {
    const { native, service } = createUpdater();
    native.downloadUpdate.mockRejectedValueOnce(new Error('offline'));
    native.emit('update-available', { version: '1.2.0' });

    await expect(service.download()).rejects.toThrow('Unable to download');

    expect(service.getStatus()).toEqual({ state: 'available', version: '1.2.0' });
  });
});

describe('update check scheduling', () => {
  it('uses persisted time, checks once when due, and lets manual checks bypass the interval', async () => {
    let now = UPDATE_CHECK_INTERVAL_MS * 2;
    const saveLastCheckedAt = jest.fn(async () => {});
    const { native, service } = createUpdater(true, {
      lastCheckedAt: now - 1000, now: () => now, saveLastCheckedAt,
    });
    await service.checkIfDue();
    expect(native.checkForUpdates).not.toHaveBeenCalled();
    now += UPDATE_CHECK_INTERVAL_MS;
    await Promise.all([service.checkIfDue(), service.checkIfDue(), service.check()]);
    expect(native.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(saveLastCheckedAt).toHaveBeenCalledWith(now);
    await service.checkIfDue();
    expect(native.checkForUpdates).toHaveBeenCalledTimes(1);
    await service.check();
    expect(native.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('throttles failed automatic attempts but exposes failures to manual callers', async () => {
    const { native, service } = createUpdater();
    native.checkForUpdates.mockRejectedValue(new Error('offline'));
    await expect(service.checkIfDue()).resolves.toBeUndefined();
    await service.checkIfDue();
    expect(native.checkForUpdates).toHaveBeenCalledTimes(1);
    await expect(service.check()).rejects.toThrow('offline');
  });

  it('recovers from a clock moving backwards', async () => {
    const { native, service } = createUpdater(true, { lastCheckedAt: 200, now: () => 100 });
    await service.checkIfDue();
    expect(native.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('does not replace a download or a ready installer with a check', async () => {
    const { native, service } = createUpdater();
    native.emit('update-available', { version: '1.2.0' });
    const download = service.download();
    await service.check();
    await service.checkIfDue();
    expect(service.getStatus().state).toBe('downloading');
    native.emit('update-downloaded', { version: '1.2.0' });
    await download;
    await service.check();
    expect(service.getStatus().state).toBe('downloaded');
    expect(native.checkForUpdates).not.toHaveBeenCalled();
  });
});
