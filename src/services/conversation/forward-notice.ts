import { createStore } from 'zustand/vanilla';

import type { ShareTarget } from '@/lib/share/share-target';

export type ForwardNotice = {
  id: number;
  accountPubkey: string;
  sourceConversationKey: string;
  targets: ShareTarget[];
};

/** Keep only navigation metadata; delivery remains owned by the outbox. */
export const forwardNoticeStore = createStore<{ notice: ForwardNotice | null }>(() => ({
  notice: null,
}));

export function showForwardNotice(
  id: number,
  accountPubkey: string,
  sourceConversationKey: string,
  targets: ShareTarget[],
): void {
  forwardNoticeStore.setState({ notice: { id, accountPubkey, sourceConversationKey, targets } });
}

export function dismissForwardNotice(id: number): void {
  if (forwardNoticeStore.getState().notice?.id === id) {
    forwardNoticeStore.setState({ notice: null });
  }
}
