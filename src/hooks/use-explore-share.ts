import { platform } from '@/platform';
import { useCallback } from 'react';
import { router } from 'expo-router';
import { KIND_CHAT } from '@/services/crypto/nip17-gift-wrap';
import { useForwardDraftStore } from '@/stores/forward-draft.store';
import { applicationShareLink, type ExploreEntry } from '@/services/explore/model';
import { useTranslation } from 'react-i18next';
import { showToast } from '@/stores/toast.store';
export function useExploreShare(account: string | null) {
  const { t } = useTranslation();
  return useCallback((entry: ExploreEntry) => {
    if (!account)
      return;
    if(platform.napplet.windows?.isHost) { void platform.napplet.windows.action({type:'share',accountPubkey:account,title:entry.title,address:applicationShareLink(entry)});return; }
    const share = () => {
      useForwardDraftStore.getState().start({ accountPubkey: account, sourceConversationKey: null, messages: [{ kind: KIND_CHAT,
          content: applicationShareLink(entry), tags: [] }] });
      router.push('/forward');
    };
    if (platform.napplet.tasks?.active()) {
      void platform.napplet.tasks.showHost().then(share).catch(() => showToast(t('napplets.request_failed'), { variant: 'error' }));
    } else share();
  }, [account, t]);
}
