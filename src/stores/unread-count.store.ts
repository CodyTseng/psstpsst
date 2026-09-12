import { useStore } from 'zustand';

import { unreadCountStore } from '@/services/conversation/unread-count.service';

/** React binding for the service-owned active-account unread read model. */
export function useUnreadCount(accountPubkey: string, enabled = true): number {
  return useStore(unreadCountStore, (state) =>
    enabled && state.accountPubkey === accountPubkey ? state.count : 0,
  );
}
