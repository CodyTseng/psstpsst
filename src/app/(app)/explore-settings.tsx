import { router } from 'expo-router';
import { Widget } from '@solar-icons/react-native/category/settings/Linear/Widget';
import RotateCcwClock from 'lucide-react-native/icons/rotate-ccw-clock';
import { useTranslation } from 'react-i18next';
import { ScrollView } from 'react-native';

import { AppScreen } from '@/components/common/AppScreen';
import { DirectionalChevron } from '@/components/common/DirectionalChevron';
import { ListGroup } from '@/components/common/ListGroup';
import { ListRow } from '@/components/common/ListRow';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { useScrolled } from '@/hooks/use-scrolled';
import { spacing, useThemeColors } from '@/theme';
import { iconStrokeWidth } from '@/theme/icons';

export default function ExploreSettingsScreen() {
  const { t } = useTranslation();
  const c = useThemeColors();
  const clearance = useScreenHeaderClearance();
  const { scrolled, scrollProps } = useScrolled();

  return (
    <AppScreen edges={[]}>
      <ScrollView {...scrollProps} contentContainerStyle={{
        paddingHorizontal: spacing.lg,
        paddingTop: clearance + spacing.sm,
        paddingBottom: spacing['2xl'],
      }}>
        <ListGroup>
          <ListRow
            title={t('applications.recent')}
            icon={<RotateCcwClock size={22} strokeWidth={iconStrokeWidth.default} color={c.text} />}
            trailing={<DirectionalChevron size={18} color={c.textMuted} />}
            onPress={() => router.push('/explore-recent')}
          />
          <ListRow
            title={t('applications.default_apps')}
            icon={<Widget size={22} color={c.text} />}
            trailing={<DirectionalChevron size={18} color={c.textMuted} />}
            onPress={() => router.push('/explore-default-apps')}
          />
        </ListGroup>
      </ScrollView>
      <ScreenHeader title={t('settings.title')} bordered={scrolled} />
    </AppScreen>
  );
}
