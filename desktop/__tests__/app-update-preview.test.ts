import { DesktopAppUpdater } from '../app-updater';
import { createPreviewUpdateInfo, PreviewAppUpdater } from '../app-update-preview';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it('offers untranslated sample history newer than the running development build', async () => {
  const native = new PreviewAppUpdater('26.10.6');
  const service = new DesktopAppUpdater({ enabled: true, preview: true, updater: native,
    emitStatus: jest.fn(), prepareToInstall: async () => {} });
  await service.check();
  const status = service.getStatus();
  expect(status).toMatchObject({ state: 'available', preview: true, version: '26.10.9' });
  if (!('changelog' in status)) throw new Error('Expected sample history');
  expect(status.changelog!.map(entry => entry.version)).toEqual(['26.10.9', '26.10.8', '26.10.7']);
  expect(status.changelog![0].note).toContain('Improvements');
  expect(jest.getTimerCount()).toBe(0);
});

it('simulates progress and returns to ready after installation without real artifacts', async () => {
  const native = new PreviewAppUpdater('26.10.6');
  const prepare = jest.fn(async () => {});
  const service = new DesktopAppUpdater({ enabled: true, preview: true, updater: native,
    emitStatus: jest.fn(), prepareToInstall: prepare });
  await service.check();
  const download = service.download();
  jest.advanceTimersByTime(400);
  expect(service.getStatus()).toMatchObject({ state: 'downloading', preview: true, percent: 5 });
  jest.advanceTimersByTime(8400);
  await download;
  expect(service.getStatus()).toMatchObject({ state: 'downloaded', preview: true });
  await service.install();
  expect(service.getStatus()).toMatchObject({ state: 'installing', preview: true });
  jest.advanceTimersByTime(600);
  expect(service.getStatus()).toMatchObject({ state: 'downloaded', preview: true });
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

it('shares the same English notes across standalone and in-app previews', () => {
  const info = createPreviewUpdateInfo('2.4.9');
  expect(info.version).toBe('2.4.12');
  expect(info.files).toEqual([]);
  const source = createPreviewUpdateInfo('26.10.6').releaseNotes;
  if (!Array.isArray(source)) throw new Error('Expected sample history');
  expect(info.releaseNotes).toEqual(source.map((entry, index) => ({
    ...entry, version: `2.4.${12 - index}`,
  })));
});
