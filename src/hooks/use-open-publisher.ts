import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { platform } from '@/platform';
import { pushOnce } from '@/lib/navigation';
import { isPublicKey } from '@/services/explore/lists';
import { showToast } from '@/stores/toast.store';

/** Publisher catalogues belong to the main host, including when opened from an application task. */
export function useOpenPublisher() {
  const { t } = useTranslation();
  return useCallback((pubkey: string) => {
    if (!isPublicKey(pubkey)) return;
    void (async () => {
      if (platform.napplet.windows?.isHost) {
        await platform.napplet.windows.action({ type: 'publisher', pubkey });
        return;
      }
      if (platform.napplet.tasks?.active()) await platform.napplet.tasks.showHost();
      pushOnce({ pathname: '/explore-publisher', params: { pubkey } });
    })().catch(() => showToast(t('napplets.request_failed'), { variant: 'error' }));
  }, [t]);
}
