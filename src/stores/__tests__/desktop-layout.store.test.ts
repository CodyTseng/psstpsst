import { getDevicePreference, trySetDevicePreference } from '@/services/preferences/device-preferences.service';
import { useDesktopLayoutStore } from '../desktop-layout.store';

jest.mock('@/services/preferences/device-preferences.service', () => ({
  getDevicePreference: jest.fn(),
  trySetDevicePreference: jest.fn(async () => {}),
}));

beforeEach(() => {
  jest.clearAllMocks();
  useDesktopLayoutStore.setState({ primaryWidth: 320, loaded: false });
});

it('persists a committed width and restores it in a fresh session', async () => {
  useDesktopLayoutStore.getState().setPrimaryWidth(900);
  expect(trySetDevicePreference).toHaveBeenCalledWith('desktop.primaryPaneWidth', '900');
  useDesktopLayoutStore.setState({ primaryWidth: 320, loaded: false });
  jest.mocked(getDevicePreference).mockResolvedValue('900');
  await useDesktopLayoutStore.getState().load();
  expect(useDesktopLayoutStore.getState()).toMatchObject({ primaryWidth: 900, loaded: true });
});

it.each([null, '', 'NaN', 'Infinity', '-50', '279', '320.5'])('ignores invalid stored width %s', async (value) => {
  jest.mocked(getDevicePreference).mockResolvedValue(value);
  await useDesktopLayoutStore.getState().load();
  expect(useDesktopLayoutStore.getState()).toMatchObject({ primaryWidth: 320, loaded: true });
});

it('does not overwrite a user change with an older pending read', async () => {
  let resolve!: (value: string) => void;
  jest.mocked(getDevicePreference).mockReturnValue(new Promise((done) => { resolve = done; }));
  const loading = useDesktopLayoutStore.getState().load();
  useDesktopLayoutStore.getState().setPrimaryWidth(700);
  resolve('400');
  await loading;
  expect(useDesktopLayoutStore.getState().primaryWidth).toBe(700);
});
