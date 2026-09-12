import { EventEmitter } from 'node:events';

import {
  DesktopAppUpdater,
  type DesktopAutoUpdater,
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

function createUpdater(enabled = true) {
  const native = new FakeAutoUpdater();
  const emitStatus = jest.fn();
  const prepareToInstall = jest.fn(async () => {});
  const service = new DesktopAppUpdater({
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
