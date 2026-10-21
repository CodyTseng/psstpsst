import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { exploreService } from '@/services/explore/service';
import type { ExploreEntry } from '@/services/explore/model';
import { getExploreState } from '@/stores/explore.store';
import { showToast, type ToastTarget } from '@/stores/toast.store';

/** Menu favorite changes share persistence and success/error feedback. */
export function useApplicationFavorite(account: string | null, target?: ToastTarget) {
  const { t } = useTranslation();
  return useCallback(async (entry: ExploreEntry, favorite: boolean) => {
    if (!account) return;
    try {
      const current = getExploreState();
      if (current.account !== account || !current.loaded) await exploreService.activate(account);
      const state = getExploreState();
      if (state.account !== account || !state.loaded) return;
      const saved = state.entries.find(app => app.key === entry.key);
      const count = favorite ? state.entries.filter(app => app.desktopPosition !== null).length : 0;
      await exploreService.move(saved ?? entry, favorite ? saved?.desktopPosition ?? count : null, account);
      if (getExploreState().account === account)
        showToast(t(favorite ? 'napplets.favorited' : 'napplets.unfavorited'), { target });
    } catch {
      showToast(t('napplets.request_failed'), { target });
    }
  }, [account, target, t]);
}
