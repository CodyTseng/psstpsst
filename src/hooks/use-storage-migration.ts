import { useEffect, useState } from 'react';
import { migrateLegacyStorage } from '@/services/storage/legacy-storage-migration';

/** Gates application startup on the complete, retryable local storage upgrade. */
export function useStorageMigration(enabled: boolean) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ success: boolean; error: Error | null }>({ success: false, error: null });
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void migrateLegacyStorage().then(() => {
      if (active) setState({ success: true, error: null });
    }, error => {
      if (active) setState({ success: false, error: error instanceof Error ? error : new Error('Storage migration failed') });
    });
    return () => { active = false; };
  }, [enabled, attempt]);
  return { ...state, success: enabled && state.success, retry: () => {
    setState({ success: false, error: null });
    setAttempt(value => value + 1);
  } };
}
