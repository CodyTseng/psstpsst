import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

import { IS_ELECTRON } from '@/lib/platform';

type Options = {
  enabled: boolean;
  onDigit: (digit: string) => void;
  onDelete: () => void;
};

/** Physical keyboard input for a focused screen's on-screen amount keypad. */
export function useAmountKeypadKeyboard({ enabled, onDigit, onDelete }: Options) {
  useFocusEffect(useCallback(() => {
    if (!IS_ELECTRON || !enabled || typeof document === 'undefined') return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
      const digit = /^[0-9]$/.test(event.key);
      const deleting = event.key === 'Backspace' || event.key === 'Delete';
      if (!digit && !deleting) return;

      const target = event.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
      if (document.querySelector('[aria-modal="true"]')) return;

      event.preventDefault();
      if (digit) onDigit(event.key);
      else onDelete();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [enabled, onDigit, onDelete]));
}
