import { useEffect } from 'react';

import { IS_ELECTRON } from '@/lib/platform';

type Options = {
  active: boolean;
  onCancel: (() => void) | undefined;
};

/** Cancels an active Electron composer reply before page-level Escape handling. */
export function useElectronComposerEscape({ active, onCancel }: Options) {
  useEffect(() => {
    if (!IS_ELECTRON || !active || !onCancel || typeof document === 'undefined') return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onCancel();
    };

    // Capture Escape before React Native Web's TextInput consumes it. A modal
    // still owns dismissal while one is present, including context menus.
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [active, onCancel]);
}
