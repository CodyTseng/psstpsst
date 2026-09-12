import { Platform } from 'react-native';

import type { BackgroundMessagingPort } from '../../ports/background-messaging';

const ORIGINAL_PLATFORM_OS = Platform.OS;

type MockNativeModule = {
  isBatteryOptimizationExemptAsync?: jest.Mock<Promise<boolean>, []>;
  requestBatteryOptimizationExemptionAsync?: jest.Mock<Promise<boolean>, []>;
  schedulePulseAsync?: jest.Mock<Promise<void>, [number | null]>;
  startAsync: jest.Mock<Promise<boolean>, [string, string]>;
  stopAsync: jest.Mock<Promise<void>, []>;
  addListener: jest.Mock<{ remove(): void }, [string, () => void]>;
};

const mockNativeModule: MockNativeModule = {
  startAsync: jest.fn(async (_channelName: string, _message: string) => true),
  stopAsync: jest.fn(async () => {}),
  addListener: jest.fn((_name: string, _listener: () => void) => ({ remove: jest.fn() })),
};

let backgroundMessagingAdapter: BackgroundMessagingPort;

describe('Expo background-messaging adapter', () => {
  beforeAll(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    jest.doMock('expo-modules-core', () => ({
      ...jest.requireActual('expo-modules-core'),
      requireOptionalNativeModule: jest.fn(() => mockNativeModule),
    }));
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- load after the native module mock
      backgroundMessagingAdapter = require('../background-messaging').backgroundMessagingAdapter;
    });
  });

  beforeEach(() => {
    delete mockNativeModule.schedulePulseAsync;
    delete mockNativeModule.isBatteryOptimizationExemptAsync;
    delete mockNativeModule.requestBatteryOptimizationExemptionAsync;
  });

  afterAll(() => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: ORIGINAL_PLATFORM_OS,
    });
    jest.dontMock('expo-modules-core');
    jest.restoreAllMocks();
  });

  it('tolerates legacy periodic clocks and forwards one-shot deadlines on newer builds', async () => {
    await expect(backgroundMessagingAdapter.schedulePulse(1_000)).resolves.toBeUndefined();
    mockNativeModule.schedulePulseAsync = jest.fn(async (_deadline: number | null) => {});
    await backgroundMessagingAdapter.schedulePulse(2_000);
    await backgroundMessagingAdapter.schedulePulse(null);
    expect(mockNativeModule.schedulePulseAsync.mock.calls).toEqual([[2_000], [null]]);
  });

  it('skips battery optimization APIs that are absent from an older native build', async () => {
    await expect(backgroundMessagingAdapter.isBatteryOptimizationExempt()).resolves.toBe(true);
    await expect(
      backgroundMessagingAdapter.requestBatteryOptimizationExemption(),
    ).resolves.toBe(false);
  });

  it('uses battery optimization APIs when the native build provides them', async () => {
    mockNativeModule.isBatteryOptimizationExemptAsync = jest.fn(async () => false);
    mockNativeModule.requestBatteryOptimizationExemptionAsync = jest.fn(async () => true);

    await expect(backgroundMessagingAdapter.isBatteryOptimizationExempt()).resolves.toBe(false);
    await expect(
      backgroundMessagingAdapter.requestBatteryOptimizationExemption(),
    ).resolves.toBe(true);
  });
});
