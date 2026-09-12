import { useEffect, useRef, useState } from 'react';
import type { View } from 'react-native';

import {
  composerFilesFromDataTransfer,
  dataTransferHasFiles,
  type ComposerFile,
} from '@/lib/attachments/composer-file';
import { IS_ELECTRON } from '@/lib/platform';

type Options = {
  enabled: boolean;
  onDropFiles: (files: ComposerFile[]) => void;
};

/**
 * Bind one Electron renderer element as a file drop target. High-frequency
 * dragover events update React only when the active state actually changes.
 */
export function useElectronFileDrop({ enabled, onDropFiles }: Options) {
  const targetRef = useRef<View>(null);
  const enabledRef = useRef(enabled);
  const onDropFilesRef = useRef(onDropFiles);
  const activeRef = useRef(false);
  const [active, setActive] = useState(false);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    onDropFilesRef.current = onDropFiles;
  }, [onDropFiles]);

  useEffect(() => {
    if (!IS_ELECTRON) return;
    const target = targetRef.current as unknown as HTMLElement | null;
    if (!target?.addEventListener) return;

    const updateActive = (next: boolean) => {
      if (activeRef.current === next) return;
      activeRef.current = next;
      setActive(next);
    };
    const acceptFileDrag = (event: DragEvent) => {
      if (!dataTransferHasFiles(event.dataTransfer)) return false;
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = enabledRef.current ? 'copy' : 'none';
      }
      return true;
    };
    const handleDragEnter = (event: DragEvent) => {
      if (!acceptFileDrag(event) || !enabledRef.current) return;
      updateActive(true);
    };
    const handleDragOver = (event: DragEvent) => {
      if (!acceptFileDrag(event) || !enabledRef.current) return;
      updateActive(true);
    };
    const handleDragLeave = (event: DragEvent) => {
      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && target.contains(nextTarget)) return;
      updateActive(false);
    };
    const handleDrop = (event: DragEvent) => {
      if (!acceptFileDrag(event)) return;
      event.stopPropagation();
      updateActive(false);
      if (!enabledRef.current) return;
      const files = composerFilesFromDataTransfer(event.dataTransfer);
      if (files.length > 0) onDropFilesRef.current(files);
    };

    target.addEventListener('dragenter', handleDragEnter);
    target.addEventListener('dragover', handleDragOver);
    target.addEventListener('dragleave', handleDragLeave);
    target.addEventListener('drop', handleDrop);
    return () => {
      target.removeEventListener('dragenter', handleDragEnter);
      target.removeEventListener('dragover', handleDragOver);
      target.removeEventListener('dragleave', handleDragLeave);
      target.removeEventListener('drop', handleDrop);
      activeRef.current = false;
    };
  }, []);

  return { targetRef, active: active && enabled };
}
