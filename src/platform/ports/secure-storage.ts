/**
 * Port for credential-grade key/value storage (the OS keychain/keystore on
 * mobile, Electron's safeStorage on desktop). Holds **secrets only** — identity
 * keys, NIP-46 credentials, NWC secrets, proximity keys. Non-secret preferences
 * live in the SQLite `device_preferences` table instead (see docs/ARCHITECTURE.md).
 *
 * All port methods are async-first: an adapter backed by a synchronous API
 * simply returns an already-resolved promise, so swapping in an async backend
 * (e.g. one that crosses an IPC boundary) never touches call sites.
 */
export interface SecureStoragePort {
  accessStatus(): Promise<'available' | 'password_setup_required' | 'password_required'>;
  configurePassword(password: string): Promise<void>;
  unlockWithPassword(password: string): Promise<boolean>;
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}
