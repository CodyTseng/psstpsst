import { getDevicePreference, trySetDevicePreference } from '@/services/preferences/device-preferences.service';

jest.mock('@/services/preferences/device-preferences.service', () => ({
  getDevicePreference: jest.fn(),
  trySetDevicePreference: jest.fn(async () => {}),
}));
jest.mock('@/services/signer/client-metadata', () => ({ DEFAULT_SIGNER_CLIENT_NAME: 'PsstPsst (iOS)' }));

let store: typeof import('../signer-client-name.store').useSignerClientNameStore;
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.isolateModules(() => {
    store = jest.requireActual<typeof import('../signer-client-name.store')>('../signer-client-name.store').useSignerClientNameStore;
  });
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

it('restores the saved device name once for both pairing flows', async () => {
  jest.mocked(getDevicePreference).mockResolvedValue('My phone');
  await Promise.all([store.getState().load(), store.getState().load()]);
  expect(store.getState()).toMatchObject({ name: 'My phone', loaded: true });
  await store.getState().load();
  expect(getDevicePreference).toHaveBeenCalledTimes(1);
  expect(trySetDevicePreference).not.toHaveBeenCalled();
});

it('uses the platform name when no custom name is saved', async () => {
  jest.mocked(getDevicePreference).mockResolvedValue(null);
  await store.getState().load();
  expect(store.getState()).toMatchObject({ name: 'PsstPsst (iOS)', loaded: true });
});

it('updates memory immediately and saves only the last edit after typing pauses', async () => {
  store.getState().setName('My');
  await jest.advanceTimersByTimeAsync(300);
  store.getState().setName('My laptop');
  expect(store.getState().name).toBe('My laptop');
  await jest.advanceTimersByTimeAsync(399);
  expect(trySetDevicePreference).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1);
  expect(trySetDevicePreference).toHaveBeenCalledTimes(1);
  expect(trySetDevicePreference).toHaveBeenCalledWith('signer.clientName', 'My laptop');
});

it('does not overwrite a new edit with an older storage read', async () => {
  let resolve!: (name: string) => void;
  jest.mocked(getDevicePreference).mockReturnValue(new Promise(done => { resolve = done; }));
  const loading = store.getState().load();
  store.getState().setName('New name');
  resolve('Old name');
  await loading;
  expect(store.getState().name).toBe('New name');
});

it('serializes saves so a slower write cannot restore an older name', async () => {
  let finish!: () => void;
  jest.mocked(trySetDevicePreference).mockImplementationOnce(() => new Promise(done => { finish = done; }));
  store.getState().setName('First');
  await jest.advanceTimersByTimeAsync(400);
  store.getState().setName('Second');
  await jest.advanceTimersByTimeAsync(400);
  expect(trySetDevicePreference).toHaveBeenCalledTimes(1);
  finish();
  await jest.advanceTimersByTimeAsync(0);
  expect(trySetDevicePreference).toHaveBeenLastCalledWith('signer.clientName', 'Second');
});
