import { useEffect } from 'react';
import { router } from 'expo-router';
import { platform } from '@/platform';
import { KIND_CHAT } from '@/services/crypto/nip17-gift-wrap';
import { useActiveAccount } from '@/stores/active-account.store';
import { useForwardDraftStore } from '@/stores/forward-draft.store';
import { notifyExploreVisit } from '@/services/explore/visits';
import { applicationPresence } from '@/services/explore/application-presence';
import { useInlineApplicationLaunch } from './use-inline-application-launch';

/** Navigation and message composition belong to the main application host. */
export function useApplicationWindowActions() {
  useInlineApplicationLaunch();
  useEffect(() => applicationPresence.observeWindows(), []);
  useEffect(() => platform.napplet.windows?.onAction(action => {
    if (useActiveAccount.getState().status !== 'ready') return;
    if (action.type === 'visited') {
      notifyExploreVisit(action);
    } else if (action.type === 'profile') {
      router.push(`/profile/${action.pubkey}`);
    } else if (action.type === 'publisher') {
      router.push({ pathname: '/explore-publisher', params: { pubkey: action.pubkey } });
    } else if (useActiveAccount.getState().activePubkey === action.accountPubkey) {
      useForwardDraftStore.getState().start({ accountPubkey: action.accountPubkey, sourceConversationKey: null,
        messages: [{ kind: KIND_CHAT, content: action.address, tags: [] }] });
      router.push('/forward');
    }
  }), []);
}
