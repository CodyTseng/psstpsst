import { Radar2 } from '@solar-icons/react-native/category/map/Linear/Radar2';
import { useTranslation } from 'react-i18next';
import { View, type ViewStyle } from 'react-native';

import type { NearbyConnectionStatus } from '@/stores/proximity.store';
import { radius, spacing, useThemeColors } from '@/theme';

/** Icon-only transport marker for a Nearby Messaging conversation. */
export function NearbyBadge({
  status = 'disconnected',
  style,
}: {
  status?: NearbyConnectionStatus;
  style?: ViewStyle;
}) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const connected = status === 'connected';
  const connecting = status === 'connecting';
  const backgroundColor = connected
    ? c.successSoft
    : connecting
      ? c.warningSoft
      : c.interactionOverlay;
  const iconColor = connected ? c.success : connecting ? c.warning : c.textMuted;
  const statusLabel = connected
    ? t('nearby.list_connected')
    : connecting
      ? t('nearby.connecting')
      : t('nearby.disconnected');

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${t('nearby.conversation_indicator')}, ${statusLabel}`}
      style={[
        {
          alignSelf: 'flex-start',
          padding: spacing.xs,
          borderRadius: radius.full,
          backgroundColor,
        },
        style,
      ]}
    >
      <Radar2 size={14} color={iconColor} />
    </View>
  );
}
