import { View } from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';
import Reanimated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { BlockedBadge } from '@/components/blocked/BlockedBadge';
import { Avatar } from '@/components/common/Avatar';
import { AppText } from '@/components/common/AppText';
import { SelectionDot } from '@/components/common/SelectionDot';
import { SelfBadge } from '@/components/common/SelfBadge';
import { useIsBlocked } from '@/hooks/use-blocked';
import { useIsRTL } from '@/i18n/direction';
import { useActiveAccount } from '@/stores/active-account.store';
import { uiDensity, useThemeColors } from '@/theme';

// Leading checkbox column: the 22px dot + ~12px gap to the avatar. In multi-select
// the row content slides right by this so the dot never overlaps it.
const SELECT_COL = 34;

type Props = {
  counterpartyPubkey: string;
  displayName: string;
  /** Published username, shown as a quiet grey second line beneath a nickname.
   * Null when there's no petname (the name then stands alone). */
  secondaryName?: string | null;
  picture?: string | null;
  onPress: () => void;
  /** Multi-select: `undefined` = no checkbox; `true`/`false` = show a leading
   * selection dot (filled accent ✓ when selected, hollow ring otherwise). In
   * this mode `onPress` toggles selection rather than navigating. */
  selected?: boolean;
  /** 0→1 progress of the list's multi-select mode, shared across all rows so they
   * slide together on the toggle — and a row scrolled in *after* the toggle reads
   * the settled value (1) instead of replaying the slide from 0. */
  selectProgress?: SharedValue<number>;
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
  onPress,
  selected,
  selectProgress,
}: Props) {
  const c = useThemeColors();
  const isRTL = useIsRTL();
  const accountPubkey = useActiveAccount((s) => s.activePubkey) ?? '';
  const blocked = useIsBlocked(accountPubkey, counterpartyPubkey) === true;
  // Genuinely our own key → the unforgeable "You" marker on the note-to-self row.
  const isSelf = !!accountPubkey && counterpartyPubkey === accountPubkey;

  // Slide the content right to clear the checkbox column, and fade the dot in —
  // both driven by the shared progress so the whole list animates as one.
  // Reserve the translated width at the end so long names stay inside the row.
  const contentShift = useAnimatedStyle(() => {
    const p = selectProgress ? selectProgress.value : 0;
    return {
      marginEnd: p * SELECT_COL,
      transform: [{ translateX: p * SELECT_COL * (isRTL ? -1 : 1) }],
    };
  });
  const dotFade = useAnimatedStyle(() => ({
    opacity: selectProgress ? selectProgress.value : 0,
  }));

  return (
    <Pressable
      onPress={onPress}
      pressFeedback="delayed"
      style={({ pressed }) => ({
        height: uiDensity.contactRowHeight,
        paddingHorizontal: 16,
        justifyContent: 'center',
        backgroundColor: pressed ? c.interactionOverlay : 'transparent',
      })}
    >
      {/* Leading checkbox — absolutely placed so it never reflows the row; the
          content slides over it (contentShift). Only present in multi-select. */}
      {selected !== undefined ? (
        <Reanimated.View
          style={[
            { position: 'absolute', start: 16, top: 0, bottom: 0, justifyContent: 'center' },
            dotFade,
            { pointerEvents: 'none' },
          ]}
        >
          <SelectionDot selected={selected} />
        </Reanimated.View>
      ) : null}

      <Reanimated.View
        style={[{ flexDirection: 'row', alignItems: 'center', gap: 12 }, contentShift]}
      >
        <Avatar
          pubkey={counterpartyPubkey}
          picture={picture}
          name={displayName}
          size={uiDensity.contactAvatarSize}
        />
        <View style={{ flex: 1 }}>
          {/* Name line, with the "Blocked" tag as a leading prefix (before the
              name) — left-aligned, so the floating A–Z index rail never covers it. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {isSelf ? <SelfBadge /> : blocked ? <BlockedBadge /> : null}
            <AppText variant="subtitle" numberOfLines={1} style={{ flexShrink: 1 }}>
              {displayName}
            </AppText>
          </View>
          {secondaryName ? (
            <AppText variant="caption" tone="muted" numberOfLines={1}>
              {secondaryName}
            </AppText>
          ) : null}
        </View>
      </Reanimated.View>
    </Pressable>
  );
}
