import Check from 'lucide-react-native/icons/check';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { AccentPicker } from '@/components/common/AccentPicker';
import { AppScreen } from '@/components/common/AppScreen';
import { ListGroup } from '@/components/common/ListGroup';
import { ListRow } from '@/components/common/ListRow';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { SectionLabel } from '@/components/common/SectionLabel';
import { type ThemePreference, useThemeStore } from '@/stores/theme.store';
import { useScrolled } from '@/hooks/use-scrolled';
import { iconStrokeWidth } from '@/theme/icons';
import { spacing, useThemeColors } from '@/theme';

const MODES: { value: ThemePreference; labelKey: string }[] = [
  { value: 'system', labelKey: 'appearance.system' },
  { value: 'light', labelKey: 'appearance.light' },
  { value: 'dark', labelKey: 'appearance.dark' },
];

/**
 * Appearance — two choices: the light/dark **mode** (follow the system, or lock
 * to Light / Dark) and the **accent colour**. Both persist per device and apply
 * app-wide the instant they're tapped (DESIGN §2).
 */
export default function AppearanceSettings() {
  const { scrolled, scrollProps } = useScrolled();
  const { t } = useTranslation();
  const c = useThemeColors();
  const titleClearance = useScreenHeaderClearance();
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);

  return (
    <AppScreen edges={[]}>
      <ScrollView {...scrollProps} contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingTop: titleClearance + spacing.sm, paddingBottom: spacing['2xl'], gap: spacing.xl }}>
        <View style={{ gap: spacing.sm }}>
          <SectionLabel>{t('appearance.mode')}</SectionLabel>
          <ListGroup>
            {MODES.map((opt) => (
              <ListRow
                key={opt.value}
                title={t(opt.labelKey)}
                trailing={
                  preference === opt.value ? (
                    <Check strokeWidth={iconStrokeWidth.default} size={18} color={c.accent} />
                  ) : undefined
                }
                onPress={() => setPreference(opt.value)}
              />
            ))}
          </ListGroup>
        </View>

        <View style={{ gap: spacing.sm }}>
          <SectionLabel>{t('appearance.color')}</SectionLabel>
          <AccentPicker />
        </View>
      </ScrollView>
      <ScreenHeader bordered={scrolled} title={t('settings.appearance')} />
    </AppScreen>
  );
}
