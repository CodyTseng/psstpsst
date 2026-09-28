import { useEffect, useState } from 'react';

import { platform, type AppStateStatus } from '@/platform';

const MINUTE_MS = 60_000;

function currentMinute(): number {
  return Math.floor(Date.now() / MINUTE_MS);
}

/**
 * A low-frequency render revision for labels whose value changes with wall time.
 * The clock runs only while its consumer is visible and the app is foregrounded,
 * and catches up immediately when the app returns from the background.
 */
export function useMinuteClock(enabled = true): number {
  const [minute, setMinute] = useState(currentMinute);

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setTimeout> | undefined;

    const stopTimer = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    const scheduleNextMinute = () => {
      stopTimer();
      const now = Date.now();
      timer = setTimeout(() => {
        setMinute(currentMinute());
        scheduleNextMinute();
      }, MINUTE_MS - (now % MINUTE_MS));
    };
    const syncAppState = (state: AppStateStatus) => {
      stopTimer();
      if (state !== 'active' && state !== 'unknown') return;
      setMinute(currentMinute());
      scheduleNextMinute();
    };

    syncAppState(platform.appState.currentState());
    const removeAppStateListener = platform.appState.addChangeListener(syncAppState);
    return () => {
      stopTimer();
      removeAppStateListener();
    };
  }, [enabled]);

  return minute;
}
