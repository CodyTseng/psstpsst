export type AppUpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'downloaded'; version: string };

/** Electron application-binary updates. Mobile stores own this capability. */
export interface AppUpdatePort {
  getStatus(): Promise<AppUpdateStatus>;
  download(): Promise<void>;
  install(): Promise<void>;
  addStatusListener(listener: (status: AppUpdateStatus) => void): () => void;
}
