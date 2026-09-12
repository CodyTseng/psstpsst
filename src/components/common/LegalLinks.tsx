import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { platform } from '@/platform';
import { spacing, useThemeColors } from '@/theme';

import { AppButton } from './AppButton';

export const LEGAL_LINKS = [
  { label: 'legal.privacy_policy', url: 'https://psstpsst.chat/privacy/' },
  { label: 'legal.terms_of_service', url: 'https://psstpsst.chat/terms/' },
] as const;

export function LegalLinks() {
  const { t } = useTranslation();
  const c = useThemeColors();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.lg,
        paddingVertical: spacing.sm,
      }}
    >
      {LEGAL_LINKS.map(({ label, url }, index) => (
        <Fragment key={label}>
          {index > 0 ? (
            <View
              accessible={false}
              style={{
                width: StyleSheet.hairlineWidth,
                height: spacing.lg,
                backgroundColor: c.border,
                flexShrink: 0,
              }}
            />
          ) : null}
          <View style={{ flexShrink: 1, minWidth: 0 }}>
            <AppButton
              label={t(label)}
              variant="accentText"
              labelVariant="caption"
              accessibilityRole="link"
              onPress={() => {
                void platform.urlOpener.openExternalUrl(url).catch(() => {});
              }}
            />
          </View>
        </Fragment>
      ))}
    </View>
  );
}
