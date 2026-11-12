import { loadDiscoveryRelays, saveDiscoveryRelays } from '../discovery-relays';
import { getDevicePreference, setDevicePreference } from '@/services/preferences/device-preferences.service';

jest.mock('@/services/preferences/device-preferences.service', () => ({
  getDevicePreference: jest.fn(), setDevicePreference: jest.fn(),
}));

const preferences = new Map<string, string>();
beforeEach(() => {
  preferences.clear();
  jest.clearAllMocks();
  jest.mocked(getDevicePreference).mockImplementation(async key => preferences.get(key) ?? null);
  jest.mocked(setDevicePreference).mockImplementation(async (key, value) => { preferences.set(key, value); });
});

it('uses the existing directory defaults on a new device', async () => {
  expect(await loadDiscoveryRelays()).toEqual({ napp: ['wss://relay.nostrapps.com/'], napplet: ['wss://relay.napplet.soy/'] });
});

it('persists normalized, deduplicated choices independently for each format', async () => {
  await Promise.all([
    saveDiscoveryRelays('napp', ['one.example', 'wss://one.example/']),
    saveDiscoveryRelays('napplet', ['two.example']),
  ]);
  expect(await loadDiscoveryRelays()).toEqual({ napp: ['wss://one.example/'], napplet: ['wss://two.example/'] });
});

it('rejects malformed lists without overwriting saved choices', async () => {
  await saveDiscoveryRelays('napp', ['one.example']);
  await expect(saveDiscoveryRelays('napp', ['ftp://bad.example'])).rejects.toThrow();
  expect((await loadDiscoveryRelays()).napp).toEqual(['wss://one.example/']);
});

it('propagates persistence failures so the editor can retain its draft', async () => {
  jest.mocked(setDevicePreference).mockRejectedValueOnce(new Error('disk full'));
  await expect(saveDiscoveryRelays('napp', ['one.example'])).rejects.toThrow('disk full');
  expect((await loadDiscoveryRelays()).napp).toEqual(['wss://relay.nostrapps.com/']);
});


it('persists an empty source list instead of restoring defaults', async () => {
  await saveDiscoveryRelays('napplet', []);
  expect((await loadDiscoveryRelays()).napplet).toEqual([]);
});

it('serializes rapid edits and continues after a failed write', async () => {
  let fail!: (error: Error) => void;
  jest.mocked(setDevicePreference).mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  const first = saveDiscoveryRelays('napp', ['first.example']);
  const rejected = expect(first).rejects.toThrow('disk full');
  const latest = saveDiscoveryRelays('napp', ['latest.example']);
  while (!fail) await new Promise(resolve => setTimeout(resolve, 0));
  expect(setDevicePreference).toHaveBeenCalledTimes(1);
  fail(new Error('disk full'));
  await rejected;
  await latest;
  expect((await loadDiscoveryRelays()).napp).toEqual(['wss://latest.example/']);
});
