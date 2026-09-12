import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { View } from 'react-native';

import { useElectronFileDrop } from '@/hooks/use-electron-file-drop';
import {
  discardTemporaryComposerFiles,
  type ComposerFile,
} from '@/lib/attachments/composer-file';
import { IS_ELECTRON } from '@/lib/platform';
import { platform, type NativeDroppedFile } from '@/platform';

type Options = {
  enabled: boolean;
  onDropFiles: (files: ComposerFile[]) => void;
};

function nativeComposerFile(file: NativeDroppedFile): ComposerFile {
  return {
    uri: file.uri,
    temporary: true,
    name: file.name || undefined,
    mime: file.mime || 'application/octet-stream',
    size: file.size,
  };
}

/** Bind one cross-platform external file drop target. */
export function useFileDrop({ enabled, onDropFiles }: Options) {
  const nativeTargetRef = useRef<View>(null);
  const electron = useElectronFileDrop({ enabled, onDropFiles });
  const [nativeActive, setNativeActive] = useState(false);
  const handleNativeDrop = useEffectEvent((files: NativeDroppedFile[]) => {
    setNativeActive(false);
    const normalized = files.map(nativeComposerFile);
    if (!enabled) {
      discardTemporaryComposerFiles(normalized);
      return;
    }
    if (normalized.length > 0) onDropFiles(normalized);
  });
  useEffect(() => {
    if (IS_ELECTRON) return;
    const subscription = platform.fileDrop.registerTarget({
      enabled,
      onDragStateChanged: setNativeActive,
      onDrop: handleNativeDrop,
    });
    return subscription.remove;
  }, [enabled]);

  return {
    targetRef: IS_ELECTRON ? electron.targetRef : nativeTargetRef,
    active: IS_ELECTRON ? electron.active : nativeActive && enabled,
  };
}
