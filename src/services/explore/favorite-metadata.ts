import { resolveApplicationMetadata } from './application-metadata';
import { cacheFavoriteMetadata } from './repository';
import { notifyFavoritesChanged } from './favorites-events';
import type { ExploreEntry } from './model';

export { needsFavoriteMetadata } from './model';

/** Resolution shares the public application cache and never changes membership or recency. */
export async function resolveFavoriteMetadata(account: string, entry: ExploreEntry, signal: AbortSignal): Promise<ExploreEntry> {
  const resolved = await resolveApplicationMetadata(account, entry, signal);
  if (resolved === entry) return entry;
  await cacheFavoriteMetadata(account, resolved);
  notifyFavoritesChanged(account, resolved.key);
  return resolved;
}
