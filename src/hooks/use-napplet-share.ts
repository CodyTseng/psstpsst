import { useCallback } from 'react';
import { router } from 'expo-router';
import { KIND_CHAT } from '@/services/crypto/nip17-gift-wrap';
import { appShareAddress, type NappletRelease } from '@/services/napplet/protocol';
import { useForwardDraftStore } from '@/stores/forward-draft.store';

/** Share a library app without creating a running app session. */
export function useNappletShare(accountPubkey: string | null) {
  return useCallback((release: NappletRelease) => {
    if (!accountPubkey) return;
    useForwardDraftStore.getState().start({
      accountPubkey,
      sourceConversationKey: null,
      messages: [{ kind: KIND_CHAT, content: `${release.title}\n${appShareAddress(release)}`, tags: [] }],
    });
    router.push('/forward');
  }, [accountPubkey]);
}
