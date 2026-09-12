export type NativeDroppedFile = {
  uri: string;
  name: string;
  mime: string;
  size: number;
};

export type FileDropTargetOptions = {
  enabled: boolean;
  onDragStateChanged(active: boolean): void;
  onDrop(files: NativeDroppedFile[]): void;
};

export type FileDropTargetSubscription = { remove(): void };

/** Process-wide external file drop delivery for the current screen target. */
export interface FileDropPort {
  registerTarget(options: FileDropTargetOptions): FileDropTargetSubscription;
}
