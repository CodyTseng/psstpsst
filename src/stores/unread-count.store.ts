import { useStore } from 'zustand';

import { unreadCountStore } from '@/services/conversation/unread-count.service';

/** React binding for the service-owned active-account unread read model. */
export function useUnreadCount(accountPubkey: string, enabled = true): number {
  return useStore(unreadCountStore, (state) =>
    enabled &&
    state.indicatorsResolved &&
    state.indicatorsEnabled &&
    state.accountPubkey === accountPubkey
      ? state.count
      : 0,
  );
}

export function useUnreadIndicatorPreference() {
  const enabled = useStore(unreadCountStore, (state) => state.indicatorsEnabled);
  const resolved = useStore(unreadCountStore, (state) => state.indicatorsResolved);
  return { enabled, resolved };
}

export function useUnreadIndicatorsEnabled(): boolean {
  return useStore(
    unreadCountStore,
    (state) => state.indicatorsResolved && state.indicatorsEnabled,
  );
}
