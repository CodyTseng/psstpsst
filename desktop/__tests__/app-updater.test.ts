import { EventEmitter } from 'node:events';
import { parseXml } from 'builder-util-runtime';
import { computeReleaseNotes } from 'electron-updater/out/providers/GitHubProvider';

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
  fullChangelog = false;
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
    expect(native.fullChangelog).toBe(true);
  });

  it('does not check when the updater is disabled', async () => {
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
      percent: 100, transferred: 0, total: 0, bytesPerSecond: 0,
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

  it('retains an actionable download error and permits retry', async () => {
    const { native, service } = createUpdater();
    native.downloadUpdate.mockRejectedValueOnce(new Error('offline'));
    native.emit('update-available', { version: '1.2.0' });

    await expect(service.download()).rejects.toThrow('Unable to download');

    expect(service.getStatus()).toEqual({ state: 'error', version: '1.2.0', phase: 'download' });
    await service.download();
    expect(native.downloadUpdate).toHaveBeenCalledTimes(2);
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


it('preserves release notes and progress details through download completion', async () => {
  const { native, service } = createUpdater();
  native.emit('update-available', { version: '1.2.0', releaseNotes: 'Improved calls' });
  const download = service.download();
  native.emit('download-progress', { percent: 40, total: 1000, transferred: 400, bytesPerSecond: 200 });
  expect(service.getStatus()).toEqual({ state: 'downloading', version: '1.2.0', releaseNotes: 'Improved calls', percent: 40, total: 1000, transferred: 400, bytesPerSecond: 200 });
  native.emit('update-downloaded', { version: '1.2.0' });
  await download;
  native.emit('download-progress', { percent: 99 });
  expect(service.getStatus()).toEqual({ state: 'downloaded', version: '1.2.0', releaseNotes: 'Improved calls' });
  expect(native.quitAndInstall).not.toHaveBeenCalled();
});

it('guards against duplicate installs and retains an install preparation failure for retry', async () => {
  const { native, prepareToInstall, service } = createUpdater();
  native.emit('update-downloaded', { version: '1.2.0' });
  prepareToInstall.mockRejectedValueOnce(new Error('busy'));
  await expect(service.install()).rejects.toThrow('busy');
  expect(service.getStatus()).toEqual({ state: 'error', version: '1.2.0', phase: 'install' });
  const install = service.install();
  await expect(service.install()).rejects.toThrow('No downloaded');
  await install;
  expect(native.quitAndInstall).toHaveBeenCalledTimes(1);
});

it('does not pass nonfinite progress into the renderer', async () => {
  const { native, service } = createUpdater();
  native.emit('update-available', { version: '1.2.0' });
  const download = service.download();
  native.emit('download-progress', { percent: NaN, total: Infinity, transferred: -1, bytesPerSecond: NaN });
  expect(service.getStatus()).toEqual({ state: 'downloading', version: '1.2.0', percent: 0, total: 0, transferred: 0, bytesPerSecond: 0 });
  await download;
});


it('retries a failed installer without repeating completed service shutdown', async () => {
  const { native, prepareToInstall, service } = createUpdater();
  native.emit('update-downloaded', { version: '1.2.0' });
  native.quitAndInstall.mockImplementationOnce(() => { throw new Error('installer unavailable'); });
  await expect(service.install()).rejects.toThrow('installer unavailable');
  await service.install();
  expect(prepareToInstall).toHaveBeenCalledTimes(1);
  expect(native.quitAndInstall).toHaveBeenCalledTimes(2);
});


it('preserves version boundaries, missing notes, and changelog metadata through completion', async () => {
  const { native, service } = createUpdater();
  native.emit('update-available', { version: '26.10.6', releaseNotes: [
    { version: '26.10.6', note: '<p>Latest changes</p>' },
    { version: '26.10.5', note: null },
    { version: '26.10.4', note: 'Earlier changes' },
  ] });
  const expected = [
    { version: '26.10.6', note: '<p>Latest changes</p>' },
    { version: '26.10.5', note: '' },
    { version: '26.10.4', note: 'Earlier changes' },
  ];
  expect(service.getStatus()).toEqual({ state: 'available', version: '26.10.6', changelog: expected });
  const download = service.download();
  native.emit('update-downloaded', { version: '26.10.6', releaseNotes: 'Latest changes' });
  await download;
  expect(service.getStatus()).toEqual({ state: 'downloaded', version: '26.10.6', changelog: expected });
});

it('does not carry a previous release history into a different target version', () => {
  const { native, service } = createUpdater();
  native.emit('update-available', { version: '1.2.0', releaseNotes: [{ version: '1.2.0', note: 'Old' }] });
  native.emit('update-available', { version: '1.3.0', releaseNotes: 'New' });
  expect(service.getStatus()).toEqual({ state: 'available', version: '1.3.0', releaseNotes: 'New' });
});

it('bounds release-note transport without dropping version headings or hiding truncation', () => {
  const { native, service } = createUpdater();
  native.emit('update-available', { version: '1.9.0', releaseNotes: Array.from({ length: 6 }, (_, index) => ({
    version: `1.${9 - index}.0`, note: 'x'.repeat(40_000),
  })) });
  const status = service.getStatus();
  if (!('changelog' in status)) throw new Error('Expected changelog');
  expect(status.changelog).toHaveLength(6);
  expect(status.changelog!.reduce((total, entry) => total + entry.note.length, 0)).toBe(128 * 1024);
  expect(status.changelog!.every(entry => entry.truncated)).toBe(true);
});


it('selects the upgrade range and sorts numeric versions using the actual GitHub provider', () => {
  const versions = ['26.10.4', '26.9.9', '26.10.10', '26.11.0', '26.10.9', 'website-release', '26.10.3'];
  const feed = parseXml(`<feed>${versions.map(version => `<entry><link href="https://example.com/releases/tag/v${version}"/><content>Notes for ${version}</content></entry>`).join('')}</feed>`);
  const latest = feed.getElements('entry')[2];
  const current = { raw: '26.10.3' } as Parameters<typeof computeReleaseNotes>[0];
  const releaseNotes = computeReleaseNotes(current, true, feed, latest);
  expect(Array.isArray(releaseNotes) && releaseNotes.map(entry => entry.version)).toEqual(['26.10.10', '26.10.9', '26.10.4']);
  const { native, service } = createUpdater();
  native.emit('update-available', { version: '26.10.10', releaseNotes });
  expect(service.getStatus()).toMatchObject({ changelog: [
    { version: '26.10.10' }, { version: '26.10.9' }, { version: '26.10.4' },
  ] });
});
