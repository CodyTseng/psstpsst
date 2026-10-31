import { useEffect, useState } from 'react';

import { notificationService } from '@/services/notifications/notification.service';
import {
  DEFAULT_DND_WINDOW,
  DEFAULT_NOTIFICATION_CONTENT_PREFERENCES,
  type DndWindow,
  type NotificationContentPreferences,
} from '@/services/notifications/notification-prefs';

/** Reuse settled service snapshots before the first paint; never reset them for a refresh. */
export function useNotificationPreferences() {
  const [contentPreferences, setContentPreferences] = useState<NotificationContentPreferences | null>(
    () => notificationService.getCachedContentPreferences(),
  );
  const [dndWindow, setDndWindow] = useState<DndWindow | null>(() => notificationService.getCachedDndWindow());

  useEffect(() => {
    let active = true;
    void Promise.all([
      notificationService.getContentPreferences(),
      notificationService.getDndWindow(),
    ])
      .then(([preferences, dnd]) => {
        if (!active) return;
        setContentPreferences(preferences);
        setDndWindow(dnd);
      })
      .catch((error) => {
        console.warn('[notifications] Unable to load notification settings.', error);
        if (!active) return;
        setContentPreferences(DEFAULT_NOTIFICATION_CONTENT_PREFERENCES);
        setDndWindow(DEFAULT_DND_WINDOW);
      });
    return () => {
      active = false;
    };
  }, []);

  return { contentPreferences, setContentPreferences, dndWindow, setDndWindow };
}
