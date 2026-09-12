import { pubkeyToNpub } from '@/lib/nostr/keys';

/** Build the kind-14 body used when sharing a Profile contact card. */
export function shareContactContent(pubkey: string): string {
  return `nostr:${pubkeyToNpub(pubkey)}`;
}
