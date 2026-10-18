import { useEffect } from 'react';
import { router } from 'expo-router';
import { platform } from '@/platform';
import { exploreService } from '@/services/explore/service';
import { KIND_CHAT } from '@/services/crypto/nip17-gift-wrap';
import { useActiveAccount } from '@/stores/active-account.store';
import { useForwardDraftStore } from '@/stores/forward-draft.store';

/** Navigation and message composition belong to the main application host. */
export function useApplicationWindowActions() {
  useEffect(() => platform.napplet.windows?.onAction(action => {
    if (useActiveAccount.getState().status !== 'ready') return;
    if (action.type === 'visited') {
      void exploreService.refreshVisit(action.accountPubkey, action.key).catch(() => {});
    } else if (action.type === 'profile') {
      router.push(`/profile/${action.pubkey}`);
    } else if (useActiveAccount.getState().activePubkey === action.accountPubkey) {
      useForwardDraftStore.getState().start({ accountPubkey: action.accountPubkey, sourceConversationKey: null,
        messages: [{ kind: KIND_CHAT, content: `${action.title}\n${action.address}`, tags: [] }] });
      router.push('/forward');
    }
  }), []);
}
