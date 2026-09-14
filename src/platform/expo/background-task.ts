import { IS_IOS } from '@/lib/platform';

import type { BackgroundTaskPort } from '../ports/background-task';

/**
 * `expo-task-manager` / `expo-background-task` touch native modules at import,
 * which throw in a runtime not built with them (Expo Go / pre-rebuild). We load
 * them lazily and tolerate absence so the app still boots; the task simply isn't
 * registered until a native build includes them.
 */
type TaskManagerModule = typeof import('expo-task-manager');
type BackgroundTaskModule = typeof import('expo-background-task');

let TaskManager: TaskManagerModule | null = null;
let BackgroundTask: BackgroundTaskModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  TaskManager = require('expo-task-manager') as TaskManagerModule;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  BackgroundTask = require('expo-background-task') as BackgroundTaskModule;
} catch {
  TaskManager = null;
  BackgroundTask = null;
}

/** Periodic background task backed by `expo-task-manager` + `expo-background-task`. */
export const backgroundTaskAdapter: BackgroundTaskPort = (() => {
  /** Names passed to `defineTasks`; [0] is current, the rest legacy aliases. */
  let taskNames: string[] = [];

  return {
    defineTasks(names, run) {
      taskNames = names;
      if (!TaskManager || !BackgroundTask) return;
      const BG = BackgroundTask;
      const wrapped = async () => {
        const controller = new AbortController();
        let expirationSubscription: { remove(): void } | null = null;
        if (IS_IOS) {
          try {
            expirationSubscription = BG.addExpirationListener(() => {
              controller.abort(new Error('Background task execution expired'));
            });
          } catch {
            // Older native builds may not expose the expiration event.
          }
        }
        try {
          await run({ signal: controller.signal });
          return BG.BackgroundTaskResult.Success;
        } catch {
          return BG.BackgroundTaskResult.Failed;
        } finally {
          expirationSubscription?.remove();
        }
      };
      // Define at module scope of the caller's bootstrap so the OS can invoke it
      // even on a cold launch (the app was killed).
      for (const name of names) TaskManager.defineTask(name, wrapped);
    },

    async register(minimumIntervalMinutes) {
      if (!BackgroundTask) return;
      const [current, ...legacy] = taskNames;
      try {
        for (const name of legacy) {
          await BackgroundTask.unregisterTaskAsync(name).catch(() => {});
        }
        await BackgroundTask.registerTaskAsync(current, {
          minimumInterval: minimumIntervalMinutes,
        });
      } catch {
        // Background refresh may be restricted by the user / OS — nothing to do.
      }
    },

    async unregister() {
      if (!BackgroundTask) return;
      const [current] = taskNames;
      try {
        await BackgroundTask.unregisterTaskAsync(current);
      } catch {
        // Not registered — ignore.
      }
    },
  };
})();
