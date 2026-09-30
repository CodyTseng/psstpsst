import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  getDerivedGroupTitleNameLimit,
  MAX_GROUP_AVATAR_MEMBERS,
  type GroupAvatarMember,
} from '@/hooks/group-presentation-model';
import { resolveDisplayName } from '@/lib/nostr/display-name';

import { useContactsMap } from './use-contacts';
import { useProfilesMap } from './use-profile';

export function useGroupPresentation(
  accountPubkey: string,
  customName: string | null | undefined,
  memberPubkeys: readonly string[] | null | undefined,
  liveDataEnabled = true,
): { title: string; avatarMembers: GroupAvatarMember[] } {
  const { t } = useTranslation();
  const members = memberPubkeys ?? [];
  const avatarKey = members.slice(0, MAX_GROUP_AVATAR_MEMBERS).join(',');
  const avatarPubkeys = useMemo(
    () => (avatarKey ? avatarKey.split(',') : []),
    [avatarKey],
  );
  const profiles = useProfilesMap(avatarPubkeys, liveDataEnabled);
  const contacts = useContactsMap(accountPubkey, avatarPubkeys, liveDataEnabled);

  return useMemo(() => {
    const resolved = avatarPubkeys.map((pubkey): GroupAvatarMember => {
      const profile = profiles[pubkey];
      const contact = contacts[pubkey];
      return {
        pubkey,
        name: resolveDisplayName(pubkey, {
          petname: contact?.petname,
          displayName: profile?.displayName,
          name: profile?.name,
        }),
        picture: profile?.picture,
      };
    });
    const titleNameLimit = getDerivedGroupTitleNameLimit(members.length);
    const titleNames = resolved.slice(0, titleNameLimit).map((member) => member.name);
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
    customName,
    contacts,
    avatarPubkeys,
    members.length,
    profiles,
    t,
  ]);
}
