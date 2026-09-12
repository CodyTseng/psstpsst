import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppButton } from '@/components/common/AppButton';
import { AppText } from '@/components/common/AppText';
import { spacing, uiDensity, useThemeColors } from '@/theme';

type Props = {
  reason: 'removed' | 'rejected';
  reconnecting: boolean;
  available: boolean;
  onReconnect: () => void;
};

/** Explicit recovery after a trusted Nearby peer declined an automatic reconnect. */
export function NearbyReconnectNotice({ reason, reconnecting, available, onReconnect }: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingStart: spacing.lg,
        // AppButton's text variant contributes its own 8px horizontal hit
        // inset, so the smaller outer end inset keeps the visible label on the
        // same 16px content gutter as the rest of the chat chrome.
        paddingEnd: spacing.sm,
        paddingVertical: uiDensity.chatNoticeVerticalPadding,
        backgroundColor: c.surfaceMuted,
      }}
    >
      <AppText variant="caption" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
        {t(reason === 'removed' ? 'nearby.connection_removed' : 'nearby.connection_rejected')}
      </AppText>
      {/* AppButton content-hugs with `alignSelf: flex-start`; the neutral wrapper
          lets this row's center alignment position the action vertically. */}
      <View>
        <AppButton
          label={t(available || reconnecting ? 'nearby.connect' : 'nearby.offline')}
          variant="accentText"
          size="sm"
          labelVariant="caption"
          fullWidth={false}
          loading={reconnecting}
          disabled={!available}
          onPress={onReconnect}
        />
      </View>
    </View>
  );
}
