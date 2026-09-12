import { parseNostrInput } from '@/lib/nostr/keys';
import {
  expandBareNip05Name,
  isNip05Identifier,
  queryNip05Profile,
} from '@/lib/nostr/nip05';

export type NostrUserInputResolution =
  | { status: 'resolved'; pubkey: string }
  | { status: 'invalid' }
  | { status: 'nip05_not_found' };

/**
 * Resolve the user identifiers accepted by user search and recipient pickers.
 * Public keys resolve locally; NIP-05 identifiers use the existing network
 * lookup and preserve a distinct not-found result for useful UI feedback. A
 * bare name (no `@domain`) is completed on the app's own NIP-05 domain.
 */
export async function resolveNostrUserInput(
  input: string,
): Promise<NostrUserInputResolution> {
  try {
    return { status: 'resolved', pubkey: parseNostrInput(input) };
  } catch {}

  const identifier = isNip05Identifier(input) ? input : expandBareNip05Name(input);
  if (!identifier) return { status: 'invalid' };

  const profile = await queryNip05Profile(identifier);
  return profile
    ? { status: 'resolved', pubkey: profile.pubkey }
    : { status: 'nip05_not_found' };
}
