import Check from 'lucide-react-native/icons/check';
import { useTranslation } from 'react-i18next';
import { ScrollView } from 'react-native';

import { AppScreen } from '@/components/common/AppScreen';
import { ListGroup } from '@/components/common/ListGroup';
import { ListRow } from '@/components/common/ListRow';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { LANGUAGE_NAMES, LANGUAGES } from '@/i18n';
import { type LanguagePreference, useLanguageStore } from '@/stores/language.store';
import { useScrolled } from '@/hooks/use-scrolled';
import { iconStrokeWidth } from '@/theme/icons';
import { useThemeColors } from '@/theme';

/**
 * Each language is labelled in its own native script (not translated), so a user
 * who can't read the current language can still find theirs. "Follow system" is
 * the one option that tracks the current locale, so it is translated.
 */
const OPTIONS: { value: LanguagePreference; label: string }[] = [
  { value: 'system', label: '' },
  ...LANGUAGES.map((language) => ({
    value: language,
    label: LANGUAGE_NAMES[language],
  })),
];

/**
 * Language — follow the OS, or lock to one of the shipped languages. The choice
 * persists per device and applies app-wide the instant it's tapped (cf.
 * Appearance, DESIGN §2).
 */
export default function LanguageSettings() {
  const { scrolled, scrollProps } = useScrolled();
  const { t } = useTranslation();
  const c = useThemeColors();
  const titleClearance = useScreenHeaderClearance();
  const preference = useLanguageStore((s) => s.preference);
  const setPreference = useLanguageStore((s) => s.setPreference);

  return (
    <AppScreen edges={[]}>
      <ScrollView
        {...scrollProps}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: titleClearance + 8,
          paddingBottom: 32,
          gap: 24,
        }}
      >
        <ListGroup>
          {OPTIONS.map((opt) => (
            <ListRow
              key={opt.value}
              title={opt.value === 'system' ? t('language.system') : opt.label}
              trailing={
                preference === opt.value ? <Check strokeWidth={iconStrokeWidth.default} size={18} color={c.accent} /> : undefined
              }
              onPress={() => void setPreference(opt.value)}
            />
          ))}
        </ListGroup>
      </ScrollView>
      <ScreenHeader bordered={scrolled} title={t('settings.language')} />
    </AppScreen>
  );
}
