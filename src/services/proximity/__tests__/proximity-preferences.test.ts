import {
  deleteDevicePreference,
  getDevicePreference,
  setDevicePreference,
} from '@/services/preferences/device-preferences.service';

import {
  getProximityEnabled,
  removeProximityEnabledPreference,
  setProximityEnabled,
} from '../proximity-preferences';
import { proximitySessionStore } from '../proximity-session';

jest.mock('@/services/preferences/device-preferences.service', () => ({
  deleteDevicePreference: jest.fn(),
  getDevicePreference: jest.fn(),
  setDevicePreference: jest.fn(),
}));

const mockDeleteDevicePreference = jest.mocked(deleteDevicePreference);
const mockGetDevicePreference = jest.mocked(getDevicePreference);
const mockSetDevicePreference = jest.mocked(setDevicePreference);

describe('proximity preferences', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    proximitySessionStore.setState({ featureEnabledByAccount: {} });
  });

  test('keeps the feature off when no explicit setting exists', async () => {
    mockGetDevicePreference.mockResolvedValue(null);

    await expect(getProximityEnabled('account-a')).resolves.toBe(false);
    expect(mockGetDevicePreference).toHaveBeenCalledWith('proximity.enabled.account-a');
    expect(proximitySessionStore.getState().featureEnabledByAccount['account-a']).toBe(false);
  });

  test('stores the setting per account', async () => {
    await setProximityEnabled('account-a', false);
    await setProximityEnabled('account-b', true);

    expect(mockSetDevicePreference).toHaveBeenNthCalledWith(
      1,
      'proximity.enabled.account-a',
      '0',
    );
    expect(mockSetDevicePreference).toHaveBeenNthCalledWith(
      2,
      'proximity.enabled.account-b',
      '1',
    );
    expect(proximitySessionStore.getState().featureEnabledByAccount).toEqual({
      'account-a': false,
      'account-b': true,
    });
  });

  test('reads and removes an explicit off state', async () => {
    mockGetDevicePreference.mockResolvedValue('0');

    await expect(getProximityEnabled('account-a')).resolves.toBe(false);
    await removeProximityEnabledPreference('account-a');
    expect(mockDeleteDevicePreference).toHaveBeenCalledWith(
      'proximity.enabled.account-a',
    );
    expect(proximitySessionStore.getState().featureEnabledByAccount['account-a']).toBe(false);
  });
});
