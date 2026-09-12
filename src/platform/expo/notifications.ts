import { Image } from 'expo-image';
import { AppState } from 'react-native';

import type { NotificationsPort } from '../ports/notifications';

import { loadLocalNotifications } from './local-notifications';

let generation = 0;

async function cachedAvatarPath(avatarUrl: string | undefined): Promise<string | null> {
  if (!avatarUrl) return null;
  try {
    let path = await Image.getCachePathAsync(avatarUrl);
    if (!path && (await Image.prefetch(avatarUrl, 'disk'))) {
      path = await Image.getCachePathAsync(avatarUrl);
    }
    return path;
  } catch {
    // A broken or unreachable profile image must not suppress the notification.
    return null;
  }
}

export const notificationsAdapter: NotificationsPort = {
  isAvailable: () => loadLocalNotifications() !== null,

  shouldNotifyNow: () => AppState.currentState === 'background',

  addUserReturnedListener(listener) {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        generation++;
        listener();
      }
    });
    return () => subscription.remove();
  },

  async hasPermission() {
    return loadLocalNotifications()?.hasPermissionAsync() ?? false;
  },

  async ensurePermission(channelName) {
    return loadLocalNotifications()?.ensurePermissionAsync(channelName) ?? false;
  },

  setDefaultHandler() {
    // Native lifecycle handling suppresses foreground delivery without a JS round trip.
  },

  async present(content) {
    const native = loadLocalNotifications();
    if (!native) return false;
    const epoch = generation;
    if (AppState.currentState !== 'background') return true;
    const avatarPath = await cachedAvatarPath(content.avatarUrl);
    // Foreground return or account cleanup must win over in-flight image caching.
    if (generation !== epoch || AppState.currentState !== 'background') return true;
    return native.presentAsync(
      content.title, content.subtitle ?? null, content.body ?? null,
      avatarPath, content.badgeCount,
    );
  },

  async dismissAll() {
    generation++;
    await loadLocalNotifications()?.dismissAllAsync().catch(() => {});
  },
};
