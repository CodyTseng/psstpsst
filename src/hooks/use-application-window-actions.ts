import { useEffect } from 'react';
import { router } from 'expo-router';
import { platform } from '@/platform';
import { exploreService } from '@/services/explore/service';
import { KIND_CHAT } from '@/services/crypto/nip17-gift-wrap';
import { useActiveAccount } from '@/stores/active-account.store';
import { useForwardDraftStore } from '@/stores/forward-draft.store';
import { subscribeExploreVisits } from '@/services/explore/visits';
import { applicationPresence } from '@/services/explore/application-presence';

/** Navigation and message composition belong to the main application host. */
export function useApplicationWindowActions() {
  useEffect(() => applicationPresence.observeWindows(), []);
  useEffect(() => {
    if (!platform.napplet.tasks) return;
    return subscribeExploreVisits(({ accountPubkey, key }) => {
      void exploreService.refreshVisit(accountPubkey, key).catch(error => console.warn('[explore] Task visit could not refresh', error));
    });
  }, []);
  useEffect(() => platform.napplet.windows?.onAction(action => {
    if (useActiveAccount.getState().status !== 'ready') return;
    if (action.type === 'visited') {
      void exploreService.refreshVisit(action.accountPubkey, action.key).catch(() => {});
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
