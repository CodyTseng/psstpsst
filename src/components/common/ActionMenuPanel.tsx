import { Fragment, type ReactNode, useState } from 'react';
import {
  StyleSheet,
  type StyleProp,
  View,
  type ViewStyle,
} from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';

import { radius, shadow, spacing, useThemeColors } from '@/theme';

import { AppText } from './AppText';

export type ActionMenuItem = {
  key: string;
  title: string;
  icon: ReactNode;
  onPress: () => void;
  tone?: 'default' | 'danger';
  /** Start a new semantic action group above this item in pointer density. */
  separatorBefore?: boolean;
};

export type ActionMenuDensity = 'pointer' | 'touch';

export const ACTION_MENU_METRICS = {
  pointer: {
    width: 184,
    rowHeight: 34,
    iconGap: 10,
    rowPaddingH: 12,
    menuPaddingV: 0,
    edgeMargin: spacing.sm,
    radius: radius.md,
  },
  touch: {
    width: 216,
    rowHeight: 50,
    iconGap: 14,
    rowPaddingH: 18,
    menuPaddingV: 0,
    edgeMargin: spacing.lg,
    radius: radius.xl,
  },
} as const;

export const ACTION_MENU_ICON_SIZE = {
  pointer: 16,
  touch: 20,
} as const;

export function actionMenuHeight(
  items: ActionMenuItem[],
  density: ActionMenuDensity,
): number {
  const metrics = ACTION_MENU_METRICS[density];
  const separatorCount = items.filter(
    (item, index) =>
      index > 0 && (density === 'touch' || item.separatorBefore),
  ).length;
  return (
    metrics.menuPaddingV * 2 +
    items.length * metrics.rowHeight +
    separatorCount * StyleSheet.hairlineWidth
  );
}

type Props = {
  items: ActionMenuItem[];
  density?: ActionMenuDensity;
  onSelect?: (item: ActionMenuItem) => void;
  style?: StyleProp<ViewStyle>;
};

/** Shared menu chrome and rows; callers own only overlay and positioning. */
export function ActionMenuPanel({
  items,
  density = 'pointer',
  onSelect,
  style,
}: Props) {
  const c = useThemeColors();
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const metrics = ACTION_MENU_METRICS[density];

  return (
    <View
      accessibilityViewIsModal
      style={[
        styles.menu,
        {
          width: metrics.width,
          paddingVertical: metrics.menuPaddingV,
          borderRadius: metrics.radius,
          backgroundColor: c.surfaceElevated,
          borderColor: c.border,
        },
        style,
      ]}
    >
      {items.map((item, index) => (
        <Fragment key={item.key}>
          {index > 0 && (density === 'touch' || item.separatorBefore) ? (
            <View
              style={{
                height: StyleSheet.hairlineWidth,
                marginStart: density === 'touch' ? 52 : spacing.sm,
                marginEnd: density === 'touch' ? 0 : spacing.sm,
                backgroundColor: c.border,
              }}
            />
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={() => (onSelect ? onSelect(item) : item.onPress())}
            onHoverIn={() => setHoveredKey(item.key)}
            onHoverOut={() => setHoveredKey(null)}
            style={({ pressed }) => ({
              height: metrics.rowHeight,
              flexDirection: 'row',
              alignItems: 'center',
              gap: metrics.iconGap,
              paddingHorizontal: metrics.rowPaddingH,
              backgroundColor:
                pressed || (density === 'pointer' && hoveredKey === item.key)
                  ? c.interactionOverlay
                  : 'transparent',
            })}
          >
            {item.icon}
            <AppText
              variant="body"
              numberOfLines={1}
              style={{
                flex: 1,
                color: item.tone === 'danger' ? c.danger : c.text,
              }}
            >
              {item.title}
            </AppText>
          </Pressable>
        </Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  menu: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    ...shadow.float,
  },
});
