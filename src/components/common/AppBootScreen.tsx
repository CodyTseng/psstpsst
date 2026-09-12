import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';

import { AppBrandMark } from '@/components/common/AppBrandMark';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { spacing, useThemeColors } from '@/theme';

type Props = {
  /** A plain-language line naming what's happening (a `boot.*` string). */
  message: string;
};

/**
 * The startup / sign-in screen shown while the app or an account is loading.
 * Themed and branded so it reads as an intentional launch screen — continuing
 * the native splash and the welcome hero — rather than a bare spinner on a void
 * background (which, in dark mode, looked like a frozen phone). It always names
 * the current step so the user knows the app is working, not stuck. DESIGN §11.
 */
export function AppBootScreen({ message }: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();

  return (
    <AppScreen>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg }}>
        <View style={{ alignItems: 'center', gap: spacing.sm }}>
          <AppBrandMark />
          <AppText variant="display" weight="bold">
            {t('welcome.title')}
          </AppText>
        </View>
        {/* Spinner + status share one muted row at the bottom of the hero so the
            mark/wordmark stay visually centered. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <ActivityIndicator size="small" color={c.textMuted} />
          <AppText variant="body" tone="muted">
            {message}
          </AppText>
        </View>
      </View>
    </AppScreen>
  );
}
