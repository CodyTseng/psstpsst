import { useStore } from 'zustand';

import { forwardNoticeStore } from '@/services/conversation/forward-notice';

export function useForwardNotice(accountPubkey: string, sourceConversationKey: string) {
  return useStore(forwardNoticeStore, (state) => {
    const notice = state.notice;
    return notice?.accountPubkey === accountPubkey &&
      notice.sourceConversationKey === sourceConversationKey
      ? notice
      : null;
  });
}
