import { requireOptionalNativeModule } from 'expo-modules-core';
import { AppRegistry, Platform } from 'react-native';

import type {
  BackgroundMessagingContent,
  BackgroundMessagingPort,
} from '../ports/background-messaging';

type ExpoBackgroundMessagingModule = {
  isBatteryOptimizationExemptAsync?: () => Promise<boolean>;
  requestBatteryOptimizationExemptionAsync?: () => Promise<boolean>;
  startAsync(channelName: string, message: string): Promise<boolean>;
  stopAsync(): Promise<void>;
  schedulePulseAsync?: (deadline: number | null) => Promise<void>;
  addListener(name: 'onPulse', listener: () => void): { remove(): void };
};

const HEADLESS_TASK_NAME = 'PsstPsstBackgroundMessaging';
type BackgroundMessagingTaskState = {
  registered: boolean;
  shouldRun: boolean;
  resolve: (() => void) | null;
};
type BackgroundMessagingGlobal = typeof globalThis & {
  __psstPsstBackgroundMessagingTask?: BackgroundMessagingTaskState;
};

const taskGlobal = globalThis as BackgroundMessagingGlobal;
const taskState = (taskGlobal.__psstPsstBackgroundMessagingTask ??= {
  registered: false,
  shouldRun: false,
  resolve: null,
});

if (Platform.OS === 'android' && !taskState.registered) {
  taskState.registered = true;
  AppRegistry.registerHeadlessTask(HEADLESS_TASK_NAME, () => () =>
    new Promise<void>((resolve) => {
      if (!taskState.shouldRun) {
        resolve();
        return;
      }
      taskState.resolve?.();
      taskState.resolve = resolve;
    }),
  );
}

function finishHeadlessTask(): void {
  taskState.shouldRun = false;
  taskState.resolve?.();
  taskState.resolve = null;
}

let cached: ExpoBackgroundMessagingModule | null | undefined;
function load(): ExpoBackgroundMessagingModule | null {
  if (cached !== undefined) return cached;
  cached =
    Platform.OS === 'android'
      ? (requireOptionalNativeModule<ExpoBackgroundMessagingModule>(
          'ExpoBackgroundMessaging',
        ) ?? null)
      : null;
  return cached;
}

/** Android `remoteMessaging` foreground service backed by a local Expo module. */
export const backgroundMessagingAdapter: BackgroundMessagingPort = {
  isAvailable: () => load() !== null,

  isBatteryOptimizationExempt() {
    const native = load();
    return typeof native?.isBatteryOptimizationExemptAsync === 'function'
      ? native.isBatteryOptimizationExemptAsync()
      : Promise.resolve(true);
  },

  requestBatteryOptimizationExemption() {
    const native = load();
    return typeof native?.requestBatteryOptimizationExemptionAsync === 'function'
      ? native.requestBatteryOptimizationExemptionAsync()
      : Promise.resolve(false);
  },

  addPulseListener(listener) {
    const subscription = load()?.addListener('onPulse', listener);
    return () => subscription?.remove();
  },

  schedulePulse(deadline) {
    // Older native builds retain their periodic pulse until the next rebuild.
    return load()?.schedulePulseAsync?.(deadline) ?? Promise.resolve();
  },

  async start(content: BackgroundMessagingContent) {
    const native = load();
    if (!native) return false;
    taskState.shouldRun = true;
    try {
      const started = await native.startAsync(content.channelName, content.message);
      if (!started) finishHeadlessTask();
      return started;
    } catch (error) {
      finishHeadlessTask();
      throw error;
    }
  },

  stop() {
    finishHeadlessTask();
    return load()?.stopAsync() ?? Promise.resolve();
  },
};
