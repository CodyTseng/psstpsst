export type AppUpdateChangelogEntry = { version: string; note: string; truncated?: boolean };
export type AppUpdateRelease = {
  preview?: boolean;
  version: string;
  releaseNotes?: string;
  changelog?: AppUpdateChangelogEntry[];
};

export type AppUpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | ({ state: 'available' } & AppUpdateRelease)
  | ({ state: 'downloading'; percent: number; transferred?: number; total?: number; bytesPerSecond?: number } & AppUpdateRelease)
  | ({ state: 'downloaded' } & AppUpdateRelease)
  | ({ state: 'installing' } & AppUpdateRelease)
  | ({ state: 'error'; phase: 'download' | 'install' } & AppUpdateRelease);

/** Electron application-binary updates. Mobile stores own this capability. */
export interface AppUpdatePort {
  /** Cached host identity, fixed for the lifetime of a renderer. */
  readonly isHost: boolean;
  check(): Promise<AppUpdateStatus>;
  getStatus(): Promise<AppUpdateStatus>;
  openWindow(): Promise<void>;
  closeWindow(): Promise<void>;
  skipVersion(): Promise<void>;
  download(): Promise<void>;
  install(): Promise<void>;
  addStatusListener(listener: (status: AppUpdateStatus) => void): () => void;
}
