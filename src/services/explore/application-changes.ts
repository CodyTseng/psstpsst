import type { ExploreEntry } from './model';
const listeners = new Set<(entry: ExploreEntry) => void>();
export function notifyApplicationChange(entry: ExploreEntry) {
  const metadata = { ...entry, desktopPosition: null, lastUsedAt: null };
  for (const listener of listeners) listener(metadata);
}
export function subscribeApplicationChanges(listener: (entry: ExploreEntry) => void) {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
