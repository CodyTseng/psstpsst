import type { ExploreEntry } from './model';
import type { ApplicationWindowsPort } from '@/platform/ports/application-window';
import { connectFavoriteWindows } from './favorites-events';
const listeners = new Set<(entry: ExploreEntry) => void>();
const lookups = new Map<(entry: ExploreEntry) => void, (key: string) => ExploreEntry | undefined>();
let windows: ApplicationWindowsPort | undefined;
let disconnect: (() => void) | undefined;
let generation = 0;

function emit(entry: ExploreEntry) {
  const metadata = { ...entry, desktopPosition: null, lastUsedAt: null };
  for (const listener of listeners) listener(metadata);
}
export function notifyApplicationChange(entry: ExploreEntry) {
  emit(entry);
  void windows?.broadcastMetadata?.(entry.key).catch(() => {});
}
export function subscribeApplicationChanges(listener: (entry: ExploreEntry) => void, lookup?: (key: string) => ExploreEntry | undefined) {
  listeners.add(listener);
  if (lookup) lookups.set(listener, lookup);
  return () => { listeners.delete(listener); lookups.delete(listener); };
}

/** Cross-host invalidations carry a key, never force consumers to reload their windows. */
export function connectApplicationWindows(port?: ApplicationWindowsPort, readMetadata?: (entry: ExploreEntry) => Promise<ExploreEntry | undefined>) {
  connectFavoriteWindows(port);
  disconnect?.(); windows = port;
  const current = ++generation;
  const pending = new Map<string, { dirty: boolean }>();
  disconnect = port?.onMetadataChange?.(key => {
    if (!readMetadata) return;
    const existing = pending.get(key);
    if (existing) { existing.dirty = true; return; }
    const find = () => { for (const lookup of lookups.values()) { const entry = lookup(key); if (entry) return entry; } };
    if (!find()) return;
    const request = { dirty: false };
    pending.set(key, request);
    void (async () => {
      do {
        request.dirty = false;
        const reference = find();
        if (!reference || current !== generation) return;
        const entry = await readMetadata(reference);
        if (current !== generation) return;
        if (entry) emit(entry);
      } while (request.dirty);
    })().catch(() => {}).finally(() => pending.delete(key));
  });
}
