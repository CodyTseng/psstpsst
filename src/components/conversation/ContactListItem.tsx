import type { SharedValue } from 'react-native-reanimated';

import { BlockedBadge } from '@/components/blocked/BlockedBadge';
import { Avatar } from '@/components/common/Avatar';
import { IdentityListItem } from '@/components/common/IdentityListItem';
import { SelfBadge } from '@/components/common/SelfBadge';
import { useIsBlocked } from '@/hooks/use-blocked';
import { useActiveAccount } from '@/stores/active-account.store';
import { uiDensity } from '@/theme';

type Props = {
  counterpartyPubkey: string;
  displayName: string;
  /** Published username, shown as a quiet grey second line beneath a nickname.
   * Null when there's no petname (the name then stands alone). */
  secondaryName?: string | null;
  picture?: string | null;
  trailing?: React.ReactNode;
  onPress: () => void;
  /** Multi-select: `undefined` = no checkbox; `true`/`false` = show a leading
   * selection dot (filled accent ✓ when selected, hollow ring otherwise). In
   * this mode `onPress` toggles selection rather than navigating. */
  selected?: boolean;
  /** 0→1 progress of the list's multi-select mode, shared across all rows so they
   * slide together on the toggle — and a row scrolled in *after* the toggle reads
   * the settled value (1) instead of replaying the slide from 0. */
  selectProgress?: SharedValue<number>;
  showSelfBadge?: boolean;
  /** Reserve logical-end space for a sibling action overlaid by the caller. */
  trailingInset?: number;
};

/** Compact contact row — avatar + name, with a "Blocked" tag as a leading prefix
 * before the name (when blocked) and the real username on a quiet grey second
 * line (under a nickname). Everything stays left-aligned in the name column,
 * never on the trailing edge, so the contacts list's floating A–Z index rail
 * can't cover it. A constant 56px tall whether or not the second line is present;
 * the 40px avatar sits within ~2px of the 42px two-line text block, so single-
 * and two-line rows read at the same height. */
export function ContactListItem({
  counterpartyPubkey,
  displayName,
  secondaryName,
  picture,
  trailing,
  onPress,
  selected,
  selectProgress,
  showSelfBadge = true,
  trailingInset = 0,
}: Props) {
  const accountPubkey = useActiveAccount((s) => s.activePubkey) ?? '';
  const blocked = useIsBlocked(accountPubkey, counterpartyPubkey) === true;
  // Genuinely our own key → the unforgeable "You" marker on the note-to-self row.
  const isSelf = !!accountPubkey && counterpartyPubkey === accountPubkey;

  return (
    <IdentityListItem
      onPress={onPress}
      leading={(
        <Avatar
          pubkey={counterpartyPubkey}
          picture={picture}
          name={displayName}
          size={uiDensity.contactAvatarSize}
        />
      )}
      title={displayName}
      subtitle={secondaryName}
      titlePrefix={
        isSelf && showSelfBadge ? <SelfBadge /> : blocked ? <BlockedBadge /> : undefined
      }
      trailing={trailing}
      selected={selected}
      selectProgress={selectProgress}
      trailingInset={trailingInset}
    />
  );
}
