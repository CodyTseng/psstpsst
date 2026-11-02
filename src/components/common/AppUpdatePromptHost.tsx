import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { IS_ELECTRON } from '@/lib/platform';
import { platform } from '@/platform';
import { registerAppUpdateCheck } from '@/services/app-update';
import { showToast } from '@/stores/toast.store';

/** Manual checks stay in their originating UI until an update can be shown. */
export function AppUpdatePromptHost() {
  const { t } = useTranslation();
  const busy = useRef(false);

  useEffect(() => {
    if (!IS_ELECTRON) return;
    let active = true;
    const remove = registerAppUpdateCheck(async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const status = await platform.appUpdate.check();
        if (!active) return;
        if (status.state === 'idle') showToast(t('app_update.up_to_date'));
        else if (status.state !== 'checking') await platform.appUpdate.openWindow();
      } catch {
        if (active) showToast(t('app_update.check_failed'), { variant: 'error' });
      } finally {
        busy.current = false;
      }
    });
    return () => { active = false; remove(); };
  }, [t]);

  return null;
}
