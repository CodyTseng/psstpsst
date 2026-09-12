import type { UnreadIndicatorPort } from '../ports/unread-indicator';

import { loadLocalNotifications } from './local-notifications';

/** Best-effort launcher badge on Android and system app-icon badge on iOS. */
export const unreadIndicatorAdapter: UnreadIndicatorPort = {
  async setCount(count) {
    return loadLocalNotifications()?.setBadgeCountAsync(count).catch(() => false) ?? false;
  },
};
