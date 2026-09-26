import { type RefObject, useEffect } from 'react';
import type { TextInput } from 'react-native';

import {
  composerFilesFromClipboard,
  type ComposerFile,
} from '@/lib/attachments/composer-file';
import { IS_ELECTRON } from '@/lib/platform';

const EDITABLE_TARGET_SELECTOR =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]';

type Options = {
  enabled: boolean;
  inputRef: RefObject<TextInput | null>;
  onPasteFiles?: (files: ComposerFile[]) => void;
};

/** Opens the Electron attachment flow for file paste anywhere in an active chat. */
export function useElectronComposerFilePaste({
  enabled,
  inputRef,
  onPasteFiles,
}: Options) {
  useEffect(() => {
    if (!IS_ELECTRON || !enabled || typeof document === 'undefined') return;

    const handlePaste = (event: ClipboardEvent) => {
      if (event.defaultPrevented || !onPasteFiles) return;

      const input = inputRef.current as unknown as HTMLElement | null;
      const target = event.target as HTMLElement | null;
      const targetEditor = target?.closest?.(EDITABLE_TARGET_SELECTOR);
      if (targetEditor && !input?.contains(target)) return;

      const activeModal = document.querySelector('[aria-modal="true"]');
      if (activeModal && (!input || !activeModal.contains(input))) return;

      const files = composerFilesFromClipboard(event);
      if (files.length === 0) return;
      event.preventDefault();
      onPasteFiles(files);
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [enabled, inputRef, onPasteFiles]);
}
