import { resolveApplicationMetadata } from './application-metadata';
import type { ExploreEntry } from './model';
export { applicationReferenceEntry, applicationEntryFromAddress, isApplicationReference } from './application-address';

const MAX_CACHED_REFERENCES = 128;
const cache = new Map<string, { entry: ExploreEntry | null; expires: number }>();

const cacheKey = (account: string, entry: ExploreEntry) => JSON.stringify([account, entry.key]);

export function peekApplicationReference(account: string, entry: ExploreEntry): ExploreEntry | null | undefined {
  const key = cacheKey(account, entry);
  const cached = cache.get(key);
  if (!cached) return;
  if (cached.expires <= Date.now()) { cache.delete(key); return; }
  cache.delete(key); cache.set(key, cached);
  return cached.entry;
}

export async function resolveApplicationReference(account: string, entry: ExploreEntry, signal: AbortSignal,
  retry = false): Promise<ExploreEntry | null> {
  const cached = retry ? undefined : peekApplicationReference(account, entry);
  if (cached !== undefined) return cached;
  let resolved: ExploreEntry | null;
  try { resolved = await resolveApplicationMetadata(account, entry, signal); }
  catch (error) {
    if (signal.aborted) throw error;
    resolved = null;
  }
  if (!signal.aborted) {
    const key = cacheKey(account, entry);
    cache.delete(key);
    cache.set(key, { entry: resolved, expires: Date.now() + (resolved ? 60_000 : 30_000) });
    while (cache.size > MAX_CACHED_REFERENCES) cache.delete(cache.keys().next().value!);
  }
  return resolved;
}
