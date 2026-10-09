import { screenOrientationAdapter } from '../screen-orientation';

const mockLock = jest.fn<Promise<void>, [number]>().mockResolvedValue(undefined);
let mockDeviceType = 1;
jest.mock('expo-screen-orientation', () => ({
  OrientationLock: { DEFAULT: 0, PORTRAIT_UP: 3 },
  lockAsync: (lock: number) => mockLock(lock),
}));
jest.mock('expo-device', () => ({
  DeviceType: { PHONE: 1, TABLET: 2 },
  getDeviceTypeAsync: async () => mockDeviceType,
}));

beforeEach(() => {
  mockDeviceType = 1;
  mockLock.mockReset().mockResolvedValue(undefined);
});

it('serializes leaving and entering videos before restoring phone portrait', async () => {
  await Promise.all([
    screenOrientationAdapter.setVideoActive(true),
    screenOrientationAdapter.setVideoActive(false),
    screenOrientationAdapter.setVideoActive(true),
  ]);
  expect(mockLock.mock.calls).toEqual([[0], [3], [0]]);
  await screenOrientationAdapter.setVideoActive(false);
  expect(mockLock).toHaveBeenLastCalledWith(3);
});

it('leaves tablet rotation and multitasking under the normal native policy', async () => {
  mockDeviceType = 2;
  await screenOrientationAdapter.setVideoActive(true);
  await screenOrientationAdapter.setVideoActive(false);
  expect(mockLock).not.toHaveBeenCalled();
});

it('can restore portrait after an orientation request fails', async () => {
  mockLock.mockRejectedValueOnce(new Error('Unavailable'));
  await expect(screenOrientationAdapter.setVideoActive(true)).rejects.toThrow('Unavailable');
  await screenOrientationAdapter.setVideoActive(false);
  expect(mockLock).toHaveBeenLastCalledWith(3);
});
