import { dateTimePreferences, loadDateTimePreferences, refreshSystemDateTime, setDateTimePreferences, watchSystemDateTime } from '../date-time-preferences';
import { getDevicePreference, trySetDevicePreference } from '../device-preferences.service';
import { platform } from '@/platform';

jest.mock('../device-preferences.service', () => ({ getDevicePreference: jest.fn(), trySetDevicePreference: jest.fn(async () => {}) }));
jest.mock('@/platform', () => ({ platform: {
  appState: { addChangeListener: jest.fn(() => jest.fn()) },
  localization: { addChangeListener: jest.fn(() => jest.fn()), dateTimeSettings: jest.fn(async () => ({ locale: 'en-GB', uses24HourClock: true })) },
} }));

beforeEach(() => {
  jest.clearAllMocks();
  dateTimePreferences.setState({ timeFormat: 'system', dateFormat: 'system', loaded: false, customDateFormat: 'YYYY/MM/DD' });
});

it('restores both preferences and the full system region before becoming ready', async () => {
  jest.mocked(getDevicePreference).mockResolvedValue(JSON.stringify({ timeFormat: '12h', dateFormat: 'dmy' }));
  await loadDateTimePreferences();
  expect(dateTimePreferences.getState()).toMatchObject({ timeFormat: '12h', dateFormat: 'dmy', systemLocale: 'en-GB', system24Hour: true, loaded: true });
});

it.each([null, '{}', '{"timeFormat":"invalid","dateFormat":"invalid"}'])('uses system defaults for an absent or invalid preference: %s', async stored => {
  jest.mocked(getDevicePreference).mockResolvedValue(stored);
  await loadDateTimePreferences();
  expect(dateTimePreferences.getState()).toMatchObject({ timeFormat: 'system', dateFormat: 'system', loaded: true });
});

it('refreshes the system clock without changing explicit preferences', async () => {
  dateTimePreferences.setState({ timeFormat: '12h', dateFormat: 'ymd', system24Hour: false });
  await refreshSystemDateTime();
  expect(platform.localization.dateTimeSettings).toHaveBeenCalledTimes(1);
  expect(dateTimePreferences.getState()).toMatchObject({ timeFormat: '12h', dateFormat: 'ymd', system24Hour: true });
});

it('paints selections immediately and serializes complete snapshots for persistence', async () => {
  const first = setDateTimePreferences({ timeFormat: '24h' });
  const second = setDateTimePreferences({ dateFormat: 'mdy' });
  expect(dateTimePreferences.getState()).toMatchObject({ timeFormat: '24h', dateFormat: 'mdy' });
  await Promise.all([first, second]);
  expect(trySetDevicePreference).toHaveBeenNthCalledWith(1, 'dateTime.formats', JSON.stringify({ timeFormat: '24h', dateFormat: 'system', customDateFormat: 'YYYY/MM/DD' }));
  expect(trySetDevicePreference).toHaveBeenNthCalledWith(2, 'dateTime.formats', JSON.stringify({ timeFormat: '24h', dateFormat: 'mdy', customDateFormat: 'YYYY/MM/DD' }));
});


it('restores a valid custom pattern and ignores corrupted custom patterns', async () => {
  jest.mocked(getDevicePreference).mockResolvedValue(JSON.stringify({ dateFormat: 'custom', customDateFormat: 'D.M.YYYY' }));
  await loadDateTimePreferences();
  expect(dateTimePreferences.getState()).toMatchObject({ dateFormat: 'custom', customDateFormat: 'D.M.YYYY' });
  jest.mocked(getDevicePreference).mockResolvedValue(JSON.stringify({ dateFormat: 'custom', customDateFormat: 'YYYY-MM' }));
  await loadDateTimePreferences();
  expect(dateTimePreferences.getState()).toMatchObject({ dateFormat: 'system', customDateFormat: 'YYYY/MM/DD' });
});

it('persists the custom selection and pattern together and rejects invalid drafts', async () => {
  await setDateTimePreferences({ dateFormat: 'custom', customDateFormat: ' D.M.YYYY ' });
  expect(trySetDevicePreference).toHaveBeenLastCalledWith('dateTime.formats', JSON.stringify({ timeFormat: 'system', dateFormat: 'custom', customDateFormat: 'D.M.YYYY' }));
  await setDateTimePreferences({ dateFormat: 'custom', customDateFormat: 'YYYY-MM' });
  expect(trySetDevicePreference).toHaveBeenCalledTimes(1);
  expect(dateTimePreferences.getState().customDateFormat).toBe('D.M.YYYY');
});


it('refreshes after native focus notifications and foreground transitions, then removes both listeners', async () => {
  let appStateChanged!: (state: 'active' | 'background') => void;
  let settingsChanged!: () => void;
  const removeAppState = jest.fn();
  const removeLocalization = jest.fn();
  jest.mocked(platform.appState.addChangeListener).mockImplementation(listener => { appStateChanged = listener; return removeAppState; });
  jest.mocked(platform.localization.addChangeListener!).mockImplementation(listener => { settingsChanged = listener; return removeLocalization; });
  const stop = watchSystemDateTime();
  appStateChanged('background');
  expect(platform.localization.dateTimeSettings).not.toHaveBeenCalled();
  settingsChanged();
  await Promise.resolve();
  expect(platform.localization.dateTimeSettings).toHaveBeenCalledTimes(1);
  appStateChanged('active');
  await Promise.resolve();
  expect(platform.localization.dateTimeSettings).toHaveBeenCalledTimes(2);
  stop();
  expect(removeAppState).toHaveBeenCalledTimes(1);
  expect(removeLocalization).toHaveBeenCalledTimes(1);
});
