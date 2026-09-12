import { useContact } from '@/hooks/use-contacts';
import { useProfile } from '@/hooks/use-profile';
import { resolveDisplayName } from '@/lib/nostr/display-name';
import type { profiles } from '@/db/schema';
import { useActiveAccount } from '@/stores/active-account.store';

type ProfileRow = typeof profiles.$inferSelect;

/**
 * Resolve a pubkey to its display name (petname → kind-0 display_name → name →
 * abbreviated key) and the profile row behind it, fetching both as needed. One
 * place for "who is this pubkey", so every caller (inline mention, name card)
 * resolves identically off the same warm caches.
 */
export function useDisplayName(pubkey: string, liveDataEnabled = true): { name: string; profile: ProfileRow | null } {
  const accountPubkey = useActiveAccount((s) => s.activePubkey);
  const profile = useProfile(pubkey, liveDataEnabled);
  const contact = useContact(accountPubkey ?? '', pubkey, liveDataEnabled);
  const name = resolveDisplayName(pubkey, {
    petname: contact?.petname,
    displayName: profile?.displayName,
    name: profile?.name,
  });
  return { name, profile };
}
