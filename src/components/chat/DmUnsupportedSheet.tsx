import Check from 'lucide-react-native/icons/check';
import X from 'lucide-react-native/icons/x';
import RefreshCw from 'lucide-react-native/icons/refresh-cw';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { IconButton } from '@/components/common/IconButton';
import { AppText } from '@/components/common/AppText';
import { BottomSheet } from '@/components/common/BottomSheet';
import type { DmSupportStatus } from '@/hooks/use-dm-support';
import { iconStrokeWidth } from '@/theme/icons';
import { radius, spacing, uiDensity, useThemeColors } from '@/theme';

type Props = {
  visible: boolean;
  status: DmSupportStatus;
  missingEncryptionKey: boolean;
  missingRelays: boolean;
  /** Re-run the reachability check (forces a fresh relay query). */
  onRecheck: () => void;
  onClose: () => void;
};

type SummaryKey = 'checking' | 'missingRelays' | 'missingEncryptionKey' | 'unknown';

function summaryKeyFor({
  checking,
  missingEncryptionKey,
  missingRelays,
}: {
  checking: boolean;
  missingEncryptionKey: boolean;
  missingRelays: boolean;
}): SummaryKey {
  if (checking) return 'checking';
  if (missingRelays) return 'missingRelays';
  if (missingEncryptionKey) return 'missingEncryptionKey';
  return 'unknown';
}

function RequirementIcon({ checking, ok }: { checking: boolean; ok: boolean }) {
  const c = useThemeColors();
  if (checking) return <ActivityIndicator size="small" color={c.textMuted} />;
  if (ok) return <Check strokeWidth={iconStrokeWidth.default} size={18} color={c.success} />;
  return <X strokeWidth={iconStrokeWidth.default} size={18} color={c.danger} />;
}

/**
 * Why a contact can't be messaged: keep the two diagnostic requirements visible,
 * show one combined plain-language conclusion under the title, and keep Recheck
 * in the sheet header because the peer may have just published what was missing.
 */
export function DmUnsupportedSheet({
  visible,
  status,
  missingEncryptionKey,
  missingRelays,
  onRecheck,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const checking = status === 'local' || status === 'checking';
  const summary = t(
    `composer.unavailable_summary.${summaryKeyFor({ checking, missingEncryptionKey, missingRelays })}`,
  );
  const items = [
    {
      key: 'relays',
      label: t('composer.check_relays'),
      ok: !missingRelays,
    },
    {
      key: 'enc',
      label: t('composer.check_key'),
      ok: !missingEncryptionKey,
    },
  ];

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t('composer.unavailable_title')}
      headerAction={
        <IconButton
          accessibilityLabel={t('composer.recheck')}
          size={uiDensity.headerActionSize}
          icon={<RefreshCw strokeWidth={iconStrokeWidth.default} size={uiDensity.headerActionIconSize} color={c.accent} />}
          onPress={onRecheck}
          disabled={checking}
        />
      }
      contentStyle={{ gap: spacing.lg }}
    >
      <AppText variant="body" tone="muted">
        {summary}
      </AppText>

      <View
        style={{
          backgroundColor: c.surfaceMuted,
          borderRadius: radius.md,
          overflow: 'hidden',
        }}
      >
        {items.map((item, index) => (
          <View
            key={item.key}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
              borderTopColor: c.border,
              paddingHorizontal: spacing.lg,
              paddingVertical: spacing.md,
              gap: spacing.md,
            }}
          >
            <AppText variant="body" style={{ flex: 1 }}>
              {item.label}
            </AppText>
            <RequirementIcon checking={checking} ok={item.ok} />
          </View>
        ))}
      </View>
    </BottomSheet>
  );
}
