import { type RefObject, useEffect } from 'react';
import type { TextInput } from 'react-native';

import { IS_ELECTRON } from '@/lib/platform';

const EDITABLE_TARGET_SELECTOR =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]';

type Options = {
  enabled: boolean;
  inputRef: RefObject<TextInput | null>;
};

/** Focuses an available Electron chat composer when the user starts typing. */
export function useElectronComposerTypingFocus({ enabled, inputRef }: Options) {
  useEffect(() => {
    if (!IS_ELECTRON || !enabled || typeof document === 'undefined') return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Shortcut handlers run first (including capture-phase app shortcuts).
      // A consumed event or a command modifier always keeps ownership.
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return;
      }
      if (Array.from(event.key).length !== 1 && event.key !== 'Dead') return;

      const target = event.target as HTMLElement | null;
      if (target?.closest?.(EDITABLE_TARGET_SELECTOR)) return;
      if (document.querySelector('[aria-modal="true"]')) return;

      // Do not prevent the event: Chromium delivers the ensuing text input to
      // the newly focused field, preserving the first character the user typed.
      inputRef.current?.focus();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [enabled, inputRef]);
}
