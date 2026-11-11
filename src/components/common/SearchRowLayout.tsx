import { useState, type ReactNode } from 'react';
import { View, type PressableProps } from 'react-native';
import { InteractivePressable as Pressable } from './InteractivePressable';
import { InteractionOverlay } from './InteractionOverlay';
import { radius, searchFieldLayout, uiDensity, useThemeColors } from '@/theme';

type Props = {
  icon: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  overlay?: ReactNode;
  filled?: boolean;
  onPress?: () => void;
  onLongPress?: PressableProps['onLongPress'];
  accessibilityLabel?: string;
  accessibilityActions?: PressableProps['accessibilityActions'];
  onAccessibilityAction?: PressableProps['onAccessibilityAction'];
  disabled?: boolean;
};

/** Search inputs and suggestions share three columns and one action-padding compensation. */
export function SearchRowLayout({ icon, children, action, overlay, filled = false,
  onPress, onLongPress, accessibilityLabel, accessibilityActions, onAccessibilityAction, disabled,
}: Props) {
  const c = useThemeColors();
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const content = <>
    <View style={{ width: searchFieldLayout.iconSize, flexShrink: 0, alignItems: 'center' }}>{icon}</View>
    <View style={{ flex: 1, minWidth: 0, justifyContent: 'center' }}>{children}</View>
  </>;
  const contentStyle = {
    flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const,
    alignSelf: 'stretch' as const, gap: searchFieldLayout.gap, minWidth: 0,
  };
  return <View style={{
    flexDirection: 'row', alignItems: 'center', gap: searchFieldLayout.gap,
    height: uiDensity.searchBarHeight,
    paddingHorizontal: searchFieldLayout.paddingHorizontal,
    borderWidth: searchFieldLayout.borderWidth, borderColor: 'transparent',
    borderRadius: radius.md, overflow: 'hidden',
    backgroundColor: filled ? c.surfaceMuted : 'transparent',
  }}>
    {overlay}
    {!disabled && (hovered || pressed) ? <InteractionOverlay /> : null}
    {onPress ? <Pressable style={contentStyle} accessibilityRole="button"
      accessibilityLabel={accessibilityLabel} accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction} onPress={onPress} onLongPress={onLongPress}
      disabled={disabled} pressFeedback="delayed" fallbackHoverOpacity={false}
      onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
      onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)}>
      {content}
    </Pressable> : <View style={contentStyle}>{content}</View>}
    {action != null ? <View style={{
      width: searchFieldLayout.accessorySize, flexShrink: 0, alignItems: 'center',
      marginEnd: -searchFieldLayout.actionOffset, zIndex: 1,
    }}>{action}</View> : null}
  </View>;
}
