import type { ReactNode } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { AppText } from '@/components/common/AppText';
import { radius, spacing, typography, useThemeColors } from '@/theme';

export const MESSAGE_CARD_VISUAL_SIZE = spacing['2xl'] + spacing.sm;

/** One title hierarchy and visual column across all rich message references. */
export function MessageCardHeader({ visual, title, subtitle = '', reserveVisual = false }: {
  visual?: ReactNode; title: string; subtitle?: ReactNode; reserveVisual?: boolean;
}) {
  const { fontScale } = useWindowDimensions();
  const c = useThemeColors();
  return <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
    {visual || reserveVisual ? <View style={{ width: MESSAGE_CARD_VISUAL_SIZE, flexShrink: 0 }}>{visual ??
      <View style={{ width: MESSAGE_CARD_VISUAL_SIZE, height: MESSAGE_CARD_VISUAL_SIZE, borderRadius: radius.full, backgroundColor: c.surfaceMuted }} />
    }</View> : null}
    <View style={{ flex: 1, minWidth: 0 }}>
      <AppText variant="body" weight="semibold" numberOfLines={1}
        style={{ minHeight: typography.body.lineHeight * fontScale, includeFontPadding: false }}>{title || ' '}</AppText>
      {typeof subtitle === 'string' ? <MessageCardText lines={1}>{subtitle}</MessageCardText> : subtitle}
    </View>
  </View>;
}

/** Reserve the same bounded text area before and after metadata arrives. */
export function MessageCardText({ children, lines, variant = 'caption' }: {
  children: string; lines: number; variant?: 'caption' | 'body';
}) {
  const { fontScale } = useWindowDimensions();
  return <AppText variant={variant} tone={variant === 'caption' ? 'muted' : 'default'} numberOfLines={lines}
    style={{ minHeight: typography[variant].lineHeight * fontScale * lines, includeFontPadding: false }}>{children || ' '}</AppText>;
}
