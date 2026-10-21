type Listener = (account: string, key?: string) => void;
const listeners = new Set<Listener>();
export function notifyFavoritesChanged(account: string, key?: string) { for (const listener of listeners) listener(account, key); }
export function subscribeFavoritesChanged(listener: Listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
