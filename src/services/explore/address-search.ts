import { naddrEncode } from 'nostr-tools/nip19';
import type { ApplicationAddressQuery } from './address-query';
import type { ExploreEntry } from './model';
import { resolveApplicationMetadata } from './application-metadata';

export { findApplicationAddress, parseApplicationAddressQuery } from './address-query';
export type { ApplicationAddressQuery } from './address-query';

/** Search supplies only the parsed address and optional warm metadata to the common resolver. */
export async function resolveApplicationAddress(account: string, query: ApplicationAddressQuery,
  entries: readonly ExploreEntry[], signal: AbortSignal): Promise<ExploreEntry> {
  if (query.type === 'invalid') throw new Error('applications.invalid_manifest');
  const address = query.type === 'website' ? query.key : naddrEncode({ kind: query.kind,
    pubkey: query.author, identifier: query.filter['#d']?.[0] ?? '', relays: query.relays });
  return resolveApplicationMetadata(account, address, signal, { known: entries });
}
