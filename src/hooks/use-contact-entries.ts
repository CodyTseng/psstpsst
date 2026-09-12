import { useMemo } from 'react';

import { useContacts } from '@/hooks/use-contacts';
import { useProfile, useProfilesMap } from '@/hooks/use-profile';
import {
  compareContactIndexes,
  getContactIndex,
  type ContactIndex,
} from '@/lib/contacts/contact-index';
import { resolveName } from '@/lib/nostr/display-name';
import { abbreviateNpub, abbreviatePubkey } from '@/lib/nostr/format';
import { pubkeyToNpub } from '@/lib/nostr/keys';

export type ContactEntry = {
  pubkey: string;
  displayName: string;
  /** The published username, shown as a quiet second line *only* when a petname
   * overrides it (so the real name stays visible beneath the nickname). */
  secondaryName: string | null;
  picture: string | null;
  /** True when displayName came from a real profile (not a npub fallback). */
  hasResolvedName: boolean;
  /** Cached section and collation metadata shared by every contact picker. */
  index: ContactIndex;
};

function npubAbbrev(pubkey: string): string {
  try {
    return abbreviateNpub(pubkeyToNpub(pubkey));
  } catch {
    return abbreviatePubkey(pubkey);
  }
}

/**
 * The account's saved contacts as flat, name-resolved entries (incl. the
 * always-present own entry), sorted by localized address-book order. The single
 * source shared by the Contacts tab and every contact picker feeds the grouped
 * list ({@link ContactSectionList}) and any search filter over the same set.
 * `loaded` is false until the local query first resolves (so callers gate an
 * empty state on it, not `entries.length`).
 */
export function useContactEntries(accountPubkey: string | null | undefined) {
  const { contacts: items, loaded } = useContacts(accountPubkey ?? '');

  const pubkeys = useMemo(() => items.map((i) => i.pubkey), [items]);
  const petnames = useMemo(() => {
    const m: Record<string, string> = {};
    for (const i of items) if (i.petname) m[i.pubkey] = i.petname;
    return m;
  }, [items]);
  const profilesMap = useProfilesMap(pubkeys);
  // Our own profile, for the always-present own entry's name + avatar.
  const selfProfile = useProfile(accountPubkey);

  const entries = useMemo<ContactEntry[]>(() => {
    const account = accountPubkey ?? '';
    const list: ContactEntry[] = [];
    for (const pubkey of pubkeys) {
      if (pubkey === account) continue; // self is appended separately below
      const profile = profilesMap[pubkey];
      const petname = petnames[pubkey];
      // A user-set petname wins over the published profile name (shared rule).
      const resolved = resolveName({
        petname,
        displayName: profile?.displayName,
        name: profile?.name,
      });
      // The published name on its own — shown beneath the petname when one is set.
      const profileName = resolveName({ displayName: profile?.displayName, name: profile?.name });
      const displayName = resolved ?? npubAbbrev(pubkey);
      list.push({
        pubkey,
        displayName,
        secondaryName: petname && profileName ? profileName : null,
        picture: profile?.picture ?? null,
        hasResolvedName: !!resolved,
        index: getContactIndex(displayName, !!resolved),
      });
    }
    // Your own entry is always present (so the list is never empty and you can
    // message yourself), shown with your own resolved name and grouped like any
    // contact; `ContactListItem`'s `SelfBadge` marks that it's genuinely you.
    if (account) {
      const selfName = resolveName({
        displayName: selfProfile?.displayName,
        name: selfProfile?.name,
      });
      const displayName = selfName ?? npubAbbrev(account);
      list.push({
        pubkey: account,
        displayName,
        secondaryName: null,
        picture: selfProfile?.picture ?? null,
        hasResolvedName: !!selfName,
        index: getContactIndex(displayName, !!selfName),
      });
    }
    return list.sort((a, b) => {
      const indexed = compareContactIndexes(a.index, b.index);
      return indexed !== 0 ? indexed : a.pubkey.localeCompare(b.pubkey);
    });
  }, [
    pubkeys,
    profilesMap,
    petnames,
    accountPubkey,
    selfProfile?.displayName,
    selfProfile?.name,
    selfProfile?.picture,
  ]);

  return { entries, loaded };
}
