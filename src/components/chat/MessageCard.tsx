import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { AppCard } from '@/components/common/AppCard';
import { AppText } from '@/components/common/AppText';
import { InteractionOverlay } from '@/components/common/InteractionOverlay';
import { InteractivePressable } from '@/components/common/InteractivePressable';
import { contentWidth, spacing, useThemeColors } from '@/theme';
import { MessageCardFooter } from './MessageCardFooter';

/** Shared frame and interaction geometry for rich message references. */
export function MessageCard({ header, children, type, footer, metaSlot, onPress, disabled = false, accessibilityLabel }: {
  type: 'profile' | 'note' | 'application' | 'emoji_pack' | 'event';
  header: ReactNode; children?: ReactNode; footer?: ReactNode; metaSlot?: ReactNode;
  onPress?: () => void; disabled?: boolean; accessibilityLabel?: string;
}) {
  const c = useThemeColors();
  const { t } = useTranslation();
  const render = (pressed: boolean) => <AppCard variant="plain" style={{
    width: contentWidth.messageCard, maxWidth: '100%', minWidth: 0,
    padding: spacing.md, paddingBottom: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, overflow: 'hidden',
  }}>
    {pressed ? <InteractionOverlay /> : null}
    <View style={{ gap: spacing.md }}>{header}{children}</View>
    <MessageCardFooter leading={<View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <AppText variant="caption" tone="muted" numberOfLines={1} style={{ flex: 1 }}>{t(`chat.card_types.${type}`)}</AppText>
      {footer}
    </View>} metaSlot={metaSlot} />
  </AppCard>;
  if (!onPress) return render(false);
  return <InteractivePressable disabled={disabled} accessibilityRole="link" accessibilityLabel={accessibilityLabel}
    fallbackHoverOpacity={false} onPress={onPress}
    style={{ width: contentWidth.messageCard, maxWidth: '100%', alignSelf: 'flex-start' }}>
    {({ pressed }) => render(pressed)}
  </InteractivePressable>;
}
