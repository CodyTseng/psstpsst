import { useEffect, useEffectEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { showToast, type ToastTarget } from '@/stores/toast.store';

/** Announce each error transition without changing the surrounding layout. */
export function useErrorToast(error: string | null | undefined | false, target?: ToastTarget) {
  const { t } = useTranslation();
  const notify = useEffectEvent((key: string) => {
    showToast(t(key), { variant: 'error', target });
  });
  useEffect(() => {
    if (error) notify(error);
  }, [error]);
}
