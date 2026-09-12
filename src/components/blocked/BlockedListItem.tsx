import { useTranslation } from 'react-i18next';
import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';

import { AppText } from '@/components/common/AppText';
import { Avatar } from '@/components/common/Avatar';
import { useIsBlocked } from '@/hooks/use-blocked';
import { useContact } from '@/hooks/use-contacts';
import { useProfile } from '@/hooks/use-profile';
import { resolveDisplayName } from '@/lib/nostr/display-name';
import { blockUser, unblockUser } from '@/services/dm/block.service';
import { spacing, uiDensity, useThemeColors } from '@/theme';

type Props = {
  accountPubkey: string;
  pubkey: string;
  onPress: () => void;
};

/**
 * One row in the Blocked-users list: tap the row to open the profile; a trailing
 * accent **Unblock** / danger **Block** toggle. Unblocking does **not** drop the
 * row from the list (the screen keeps it for the session), so it flips to
 * "Block" and the user can re-block in one tap. Name resolves the usual way
 * (petname → profile → npub).
 */
export function BlockedListItem({ accountPubkey, pubkey, onPress }: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const profile = useProfile(pubkey);
  const contact = useContact(accountPubkey, pubkey);
  // Rows here originate from the blocked set, so default to blocked until the
  // live query resolves — the label never flashes the wrong way.
  const blocked = useIsBlocked(accountPubkey, pubkey) ?? true;
  const name = resolveDisplayName(pubkey, {
    petname: contact?.petname,
    displayName: profile?.displayName,
    name: profile?.name,
  });

  function toggle() {
    if (blocked) void unblockUser(accountPubkey, pubkey).catch(() => {});
    else void blockUser(accountPubkey, pubkey).catch(() => {});
  }

  return (
    <Pressable
      onPress={onPress}
      pressFeedback="delayed"
      style={({ pressed }) => ({
        height: uiDensity.listRowTwoLineHeight,
        paddingHorizontal: spacing.lg,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        backgroundColor: pressed ? c.interactionOverlay : 'transparent',
      })}
    >
      <Avatar
        pubkey={pubkey}
        picture={profile?.picture}
        name={name}
        size={uiDensity.contactAvatarSize}
      />
      <AppText variant="subtitle" numberOfLines={1} style={{ flex: 1 }}>
        {name}
      </AppText>
      <Pressable onPress={toggle} hitSlop={10} style={{ paddingVertical: 6, paddingStart: 12 }}>
        <AppText
          variant="body"
          weight="semibold"
          tone={blocked ? 'accent' : undefined}
          style={blocked ? undefined : { color: c.danger }}
        >
          {blocked ? t('blocked.unblock') : t('chat.block')}
        </AppText>
      </Pressable>
    </Pressable>
  );
}
