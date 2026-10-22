import type { ApplicationWindowsPort } from '@/platform/ports/application-window';
type Listener = (account: string, key?: string) => void;
const listeners = new Set<Listener>();
let windows: ApplicationWindowsPort | undefined;
let stopWindows: (() => void) | undefined;
export function connectFavoriteWindows(port?: ApplicationWindowsPort) {
  stopWindows?.(); windows = port;
  stopWindows = port?.onFavoritesChange?.(account => { for (const listener of listeners) listener(account); });
}
/** Local optimistic edits already own their model; siblings reread membership after commit. */
export function broadcastFavoriteChange(account: string) { void windows?.broadcastFavorites?.(account).catch(() => {}); }
export function notifyFavoritesChanged(account: string, key?: string) {
  for (const listener of listeners) listener(account, key);
  if (!key) broadcastFavoriteChange(account);
}
export function subscribeFavoritesChanged(listener: Listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
