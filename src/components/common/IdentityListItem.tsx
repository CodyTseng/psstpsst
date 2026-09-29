import type { ReactNode } from 'react';
import { View } from 'react-native';
import Reanimated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { useIsRTL } from '@/i18n/direction';
import { spacing, uiDensity, useThemeColors } from '@/theme';

import { AppText } from './AppText';
import { InteractivePressable as Pressable } from './InteractivePressable';
import { SelectionDot } from './SelectionDot';

// Leading checkbox column: the 22px dot plus the space before the identity
// visual. This is interaction geometry rather than general page spacing.
const SELECT_COLUMN_WIDTH = 34;

type Props = {
  leading: ReactNode;
  title: string;
  subtitle?: string | null;
  titlePrefix?: ReactNode;
  onPress: () => void;
  active?: boolean;
  /** Multi-select: `undefined` hides the selector; a boolean shows its state. */
  selected?: boolean;
  /** Shared progress keeps every visible row's selection transition in sync. */
  selectProgress?: SharedValue<number>;
  /** Reserve logical-end space for an action overlaid by the caller. */
  trailingInset?: number;
};

/**
 * Full-width identity row geometry shared by contact entries and contact-list
 * destinations. The leading visual, title, and optional subtitle keep the same
 * columns regardless of whether the visual is an avatar or a symbolic entry.
 */
export function IdentityListItem({
  leading,
  title,
  subtitle,
  titlePrefix,
  onPress,
  active,
  selected,
  selectProgress,
  trailingInset = 0,
}: Props) {
  const c = useThemeColors();
  const isRTL = useIsRTL();
  const contentShift = useAnimatedStyle(() => {
    const progress = selectProgress ? selectProgress.value : 0;
    return {
      marginEnd: progress * SELECT_COLUMN_WIDTH,
      transform: [
        { translateX: progress * SELECT_COLUMN_WIDTH * (isRTL ? -1 : 1) },
      ],
    };
  });
  const selectionFade = useAnimatedStyle(() => ({
    opacity: selectProgress ? selectProgress.value : 0,
  }));

  return (
    <Pressable
      onPress={onPress}
      pressFeedback="delayed"
      accessibilityState={active === undefined ? undefined : { selected: active }}
      style={({ pressed }) => ({
        height: uiDensity.contactRowHeight,
        paddingStart: spacing.lg,
        paddingEnd: spacing.lg + trailingInset,
        justifyContent: 'center',
        backgroundColor: pressed || active ? c.interactionOverlay : 'transparent',
      })}
    >
      {selected !== undefined ? (
        <Reanimated.View
          style={[
            {
              position: 'absolute',
              start: spacing.lg,
              top: 0,
              bottom: 0,
              justifyContent: 'center',
            },
            selectionFade,
            { pointerEvents: 'none' },
          ]}
        >
          <SelectionDot selected={selected} />
        </Reanimated.View>
      ) : null}

      <Reanimated.View
        style={[
          { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
          contentShift,
        ]}
      >
        {leading}
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            {titlePrefix}
            <AppText variant="subtitle" numberOfLines={1} style={{ flexShrink: 1 }}>
              {title}
            </AppText>
          </View>
          {subtitle ? (
            <AppText variant="caption" tone="muted" numberOfLines={1}>
              {subtitle}
            </AppText>
          ) : null}
        </View>
      </Reanimated.View>
    </Pressable>
  );
}
