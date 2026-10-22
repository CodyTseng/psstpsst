import { naddrEncode } from 'nostr-tools/nip19';
import { assertNotAborted } from '@/platform/abort';
import { findApplicationAddress, type ApplicationAddressQuery } from './address-query';
import { parseFavoriteReference } from './favorites-protocol';
import { websiteEntry, type ExploreEntry } from './model';
import { readEntries } from './repository';
import { resolveApplicationMetadata } from './application-metadata';

export { findApplicationAddress, parseApplicationAddressQuery } from './address-query';
export type { ApplicationAddressQuery } from './address-query';

export async function resolveApplicationAddress(account: string, query: ApplicationAddressQuery,
  entries: readonly ExploreEntry[], signal: AbortSignal): Promise<ExploreEntry> {
  assertNotAborted(signal);
  if (query.type === 'invalid') throw new Error('napplets.invalid_manifest');
  const cached = findApplicationAddress(query, entries) ?? findApplicationAddress(query, await readEntries(account, query.key));
  assertNotAborted(signal);
  if (query.type === 'website') return cached ?? websiteEntry(query.key);
  const identifier = query.kind >= 30000 ? query.filter['#d']?.[0] ?? '' : '';
  const entry = cached ?? parseFavoriteReference(['a', `${query.kind}:${query.author}:${identifier}`, ...(query.relays[0] ? [query.relays[0]] : [])]).entry;
  return resolveApplicationMetadata(account, { ...entry, address: naddrEncode({ kind: query.kind,
    pubkey: query.author, identifier, relays: query.relays }) }, signal);
}
