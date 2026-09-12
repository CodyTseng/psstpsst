import { requireOptionalNativeModule } from 'expo-modules-core';

export type LocalNotificationsModule = {
  hasPermissionAsync(): Promise<boolean>;
  ensurePermissionAsync(channelName: string): Promise<boolean>;
  presentAsync(title: string, subtitle: string | null, body: string | null, avatarPath: string | null, badgeCount: number): Promise<boolean>;
  dismissAllAsync(): Promise<void>;
  setBadgeCountAsync(count: number): Promise<boolean>;
};

let cached: LocalNotificationsModule | null | undefined;

/** Resolve only on first use so older native builds and Expo Go remain usable. */
export function loadLocalNotifications(): LocalNotificationsModule | null {
  if (cached === undefined) {
    try {
      cached = requireOptionalNativeModule<LocalNotificationsModule>('ExpoLocalNotifications');
    } catch {
      cached = null;
    }
  }
  return cached;
}
