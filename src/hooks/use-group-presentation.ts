import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { resolveDisplayName } from '@/lib/nostr/display-name';

import { useContact } from './use-contacts';
import { useProfile } from './use-profile';

export type GroupAvatarMember = {
  pubkey: string;
  name: string;
  picture?: string | null;
};

export function useGroupPresentation(
  accountPubkey: string,
  customName: string | null | undefined,
  memberPubkeys: readonly string[] | null | undefined,
  liveDataEnabled = true,
): { title: string; avatarMembers: GroupAvatarMember[] } {
  const { t } = useTranslation();
  const members = memberPubkeys ?? [];
  const p0 = members[0] ?? '';
  const p1 = members[1] ?? '';
  const p2 = members[2] ?? '';
  const p3 = members[3] ?? '';
  const profile0 = useProfile(p0 || null, liveDataEnabled);
  const profile1 = useProfile(p1 || null, liveDataEnabled);
  const profile2 = useProfile(p2 || null, liveDataEnabled);
  const profile3 = useProfile(p3 || null, liveDataEnabled);
  const contact0 = useContact(accountPubkey, p0, liveDataEnabled);
  const contact1 = useContact(accountPubkey, p1, liveDataEnabled);
  const contact2 = useContact(accountPubkey, p2, liveDataEnabled);
  const contact3 = useContact(accountPubkey, p3, liveDataEnabled);

  return useMemo(() => {
    const pubkeys = [p0, p1, p2, p3];
    const profiles = [profile0, profile1, profile2, profile3];
    const contacts = [contact0, contact1, contact2, contact3];
    const resolved = pubkeys.flatMap((pubkey, index): GroupAvatarMember[] => {
      if (!pubkey) return [];
      const profile = profiles[index];
      const contact = contacts[index];
      return [{
        pubkey,
        name: resolveDisplayName(pubkey, {
          petname: contact?.petname,
          displayName: profile?.displayName,
          name: profile?.name,
        }),
        picture: profile?.picture,
      }];
    });
    const titleNames = resolved.slice(0, 3).map((member) => member.name);
    const remaining = Math.max(0, members.length - titleNames.length);
    const fallback = remaining > 0
      ? t('group.derived_title_with_others', {
          names: titleNames.join(', '),
          count: remaining,
        })
      : titleNames.join(', ');
    return {
      title: customName || fallback || t('group.unnamed'),
      avatarMembers: resolved,
    };
  }, [
    contact0,
    contact1,
    contact2,
    contact3,
    customName,
    members.length,
    p0,
    p1,
    p2,
    p3,
    profile0,
    profile1,
    profile2,
    profile3,
    t,
  ]);
}
