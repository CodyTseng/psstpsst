import { useCallback, useEffect, useRef, useState } from 'react';

import { platform } from '@/platform';
import { notificationService } from '@/services/notifications/notification.service';

/** Refresh OS authorization on foreground return, without polling or prompting. */
export function useNotificationStatus() {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(false);
  const working = useRef(false);
  const revision = useRef(0);
  const enableAfterSettings = useRef(false);
  const invalidate = useCallback(() => { revision.current++; }, []);

  const refresh = useCallback(async () => {
    if (working.current) return;
    const current = ++revision.current;
    try {
      let status = await notificationService.getStatus();
      if (!mounted.current || current !== revision.current) return;
      if (enableAfterSettings.current && status.granted) {
        enableAfterSettings.current = false;
        working.current = true;
        setBusy(true);
        try {
          status = await notificationService.enable();
        } finally {
          working.current = false;
          if (mounted.current) setBusy(false);
        }
      }
      if (mounted.current && current === revision.current) {
        setEnabled(status.enabled && status.granted);
      }
    } catch (error) {
      console.warn('[notifications] Unable to refresh notification permission.', error);
      if (mounted.current && current === revision.current) setEnabled(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    // The refresh commits state only after the asynchronous OS permission read.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const remove = platform.notifications.addUserReturnedListener(() => { void refresh(); });
    return () => {
      mounted.current = false;
      invalidate();
      remove();
    };
  }, [refresh, invalidate]);

  const toggle = useCallback(async (next: boolean) => {
    if (working.current) return null;
    invalidate();
    enableAfterSettings.current = false;
    working.current = true;
    setBusy(true);
    try {
      let status;
      if (next) {
        status = await notificationService.enable();
      } else {
        await notificationService.disable();
        status = { enabled: false, granted: false };
      }
      if (mounted.current) setEnabled(status.enabled && status.granted);
      return status;
    } finally {
      working.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [invalidate]);

  const openSettings = useCallback(async () => {
    // The user already asked to enable notifications. Finish that action when
    // they return with an OS grant; otherwise leave the toggle off.
    enableAfterSettings.current = true;
    try {
      if (!(await platform.notifications.openSettings())) enableAfterSettings.current = false;
    } catch (error) {
      enableAfterSettings.current = false;
      throw error;
    }
  }, []);

  return { enabled, busy, toggle, openSettings };
}
