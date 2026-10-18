import { platform } from '@/platform';
import { useCallback } from 'react';
import { router } from 'expo-router';
import { KIND_CHAT } from '@/services/crypto/nip17-gift-wrap';
import { useForwardDraftStore } from '@/stores/forward-draft.store';
import type { ExploreEntry } from '@/services/explore/model';
export function useExploreShare(account: string | null) {
  return useCallback((entry: ExploreEntry) => {
    if (!account)
      return;
    if(platform.napplet.windows?.isHost) { void platform.napplet.windows.action({type:'share',accountPubkey:account,title:entry.title,address:entry.kind==='website'?entry.address:`nostr:${entry.address}`});return; }
    useForwardDraftStore.getState().start({ accountPubkey: account, sourceConversationKey: null, messages: [{ kind: KIND_CHAT,
          content: `${entry.title}\n${entry.kind === 'website' ? entry.address : `nostr:${entry.address}`}`, tags: [] }] });
    router.push('/forward');
  }, [account]);
}
