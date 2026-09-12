import { NativeModule, requireNativeModule } from 'expo';

import type { NativeDroppedFile } from '@/platform/ports/file-drop';

type Events = {
  onDragStateChanged(event: { active: boolean }): void;
  onDrop(event: { files: NativeDroppedFile[] }): void;
};

declare class ExpoFileDropModule extends NativeModule<Events> {
  setEnabledAsync(enabled: boolean): Promise<void>;
}

export default requireNativeModule<ExpoFileDropModule>('ExpoFileDrop');
