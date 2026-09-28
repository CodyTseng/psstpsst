import {
  deleteDevicePreference,
  getDevicePreference,
  trySetDevicePreference,
} from '@/services/preferences/device-preferences.service';
import { useTouchLayoutStore } from '../touch-layout.store';

jest.mock('@/services/preferences/device-preferences.service', () => ({
  deleteDevicePreference: jest.fn(async () => {}),
  getDevicePreference: jest.fn(),
  trySetDevicePreference: jest.fn(async () => {}),
}));

beforeEach(() => {
  jest.clearAllMocks();
  useTouchLayoutStore.setState({ primaryWidth: null, loaded: false });
});

it('persists a committed width and restores it in a fresh session', async () => {
  useTouchLayoutStore.getState().setPrimaryWidth(520);
  expect(trySetDevicePreference).toHaveBeenCalledWith('touch.primaryPaneWidth', '520');

  useTouchLayoutStore.setState({ primaryWidth: null, loaded: false });
  jest.mocked(getDevicePreference).mockResolvedValue('520');
  await useTouchLayoutStore.getState().load();

  expect(useTouchLayoutStore.getState()).toMatchObject({ primaryWidth: 520, loaded: true });
});

it('clears the custom width when restoring responsive defaults', () => {
  useTouchLayoutStore.setState({ primaryWidth: 520, loaded: true });

  useTouchLayoutStore.getState().resetPrimaryWidth();

  expect(useTouchLayoutStore.getState()).toMatchObject({ primaryWidth: null, loaded: true });
  expect(deleteDevicePreference).toHaveBeenCalledWith('touch.primaryPaneWidth');
});

it.each([null, '', 'NaN', 'Infinity', '279', '561', '320.5'])(
  'ignores invalid stored width %s',
  async (value) => {
    jest.mocked(getDevicePreference).mockResolvedValue(value);
    await useTouchLayoutStore.getState().load();
    expect(useTouchLayoutStore.getState()).toMatchObject({ primaryWidth: null, loaded: true });
  },
);

it('does not overwrite a user change with an older pending read', async () => {
  let resolve!: (value: string) => void;
  jest.mocked(getDevicePreference).mockReturnValue(new Promise((done) => { resolve = done; }));

  const loading = useTouchLayoutStore.getState().load();
  useTouchLayoutStore.getState().setPrimaryWidth(500);
  resolve('400');
  await loading;

  expect(useTouchLayoutStore.getState().primaryWidth).toBe(500);
});
