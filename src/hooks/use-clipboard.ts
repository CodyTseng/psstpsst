import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { platform } from '@/platform';
import { showToast, type ToastTarget } from '@/stores/toast.store';

const COPIED_DURATION_MS = 2_000;

/** Shared clipboard actions; copied feedback belongs to the latest copy request. */
export function useClipboard<Key extends string = string>({
  trackCopied = true,
  toastTarget,
}: { trackCopied?: boolean; toastTarget?: ToastTarget } = {}) {
  const { t } = useTranslation();
  const [confirmation, setConfirmation] = useState<{ key: Key | null } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = useRef(0);
  const mounted = useRef(false);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const resetCopied = useCallback(() => {
    request.current += 1;
    clearTimer();
    setConfirmation(null);
  }, [clearTimer]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current += 1;
      clearTimer();
    };
  }, [clearTimer]);

  const copyText = useCallback(async (text: string, key?: Key): Promise<boolean> => {
    const currentRequest = ++request.current;
    try {
      await platform.clipboard.writeText(text);
      if (trackCopied && mounted.current && currentRequest === request.current) {
        clearTimer();
        setConfirmation({ key: key ?? null });
        timer.current = setTimeout(() => {
          timer.current = null;
          setConfirmation(null);
        }, COPIED_DURATION_MS);
      }
      return true;
    } catch {
      if (mounted.current && currentRequest === request.current) {
        resetCopied();
        showToast(t('common.copy_failed'), { variant: 'error', target: toastTarget });
      }
      return false;
    }
  }, [clearTimer, resetCopied, t, toastTarget, trackCopied]);

  const readText = useCallback(async (): Promise<string | null> => {
    try {
      return await platform.clipboard.readText();
    } catch {
      showToast(t('common.paste_failed'), { variant: 'error', target: toastTarget });
      return null;
    }
  }, [t, toastTarget]);

  return {
    copyText,
    readText,
    copied: confirmation !== null,
    copiedKey: confirmation?.key ?? null,
    resetCopied,
  };
}
