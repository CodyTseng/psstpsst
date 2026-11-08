import { useEffect, useState } from 'react';
import { platform } from '@/platform';
import type { ApplicationNavigationState } from '@/platform/ports/napplet';

const EMPTY: ApplicationNavigationState = { canGoBack: false, canGoForward: false };

/** Observe only the displayed container, without retaining its history entries. */
export function useApplicationNavigation(containerId?: string | null) {
  const [snapshot, setSnapshot] = useState<{ id: string; state: ApplicationNavigationState }>();
  useEffect(() => {
    if (!containerId) return;
    let current = true, received = false;
    const update = (state: ApplicationNavigationState) => {
      if (!current) return;
      setSnapshot(previous => previous?.id === containerId && previous.state.canGoBack === state.canGoBack && previous.state.canGoForward === state.canGoForward
        ? previous : { id: containerId, state });
    };
    const unsubscribe = platform.napplet.addNavigationListener((id, state) => {
      if (id !== containerId) return;
      received = true;
      update(state);
    });
    void platform.napplet.getNavigationState(containerId).then(state => { if (!received) update(state); })
      .catch(error => console.warn('[applications] History state unavailable', error));
    return () => { current = false; unsubscribe(); };
  }, [containerId]);
  return snapshot && snapshot.id === containerId ? snapshot.state : EMPTY;
}
