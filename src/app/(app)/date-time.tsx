import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { ListGroup } from '@/components/common/ListGroup';
import { ListRow } from '@/components/common/ListRow';
import { RadioIndicator } from '@/components/common/radio-indicator';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { CustomDateFormatSetting } from '@/components/settings/CustomDateFormatSetting';
import { useScrolled } from '@/hooks/use-scrolled';
import { setDateTimePreferences, type TimeFormat, type DateFormat } from '@/services/preferences/date-time-preferences';
import { useDateTimePreferences } from '@/stores/date-time.store';
import { spacing } from '@/theme';

const TIMES: TimeFormat[] = ['system', '12h', '24h'];
const DATES: Exclude<DateFormat, 'custom'>[] = ['system', 'ymd', 'dmy', 'mdy'];
const EXAMPLES = { '12h': '1:05 PM', '24h': '13:05', ymd: '2026-01-05', dmy: '05-01-2026', mdy: '01-05-2026' };

export default function DateTimeSettings() {
  const { t } = useTranslation();
  const { timeFormat, dateFormat, customDateFormat } = useDateTimePreferences();
  const { scrolled, scrollProps } = useScrolled();
  const clearance = useScreenHeaderClearance();
  return (
    <AppScreen edges={[]}>
      <ScrollView
        {...scrollProps}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingTop: clearance + spacing.sm,
          paddingBottom: spacing['2xl'],
          gap: spacing.xl,
        }}
      >
        <View style={{ gap: spacing.sm }}>
          <AppText variant="caption" tone="muted">{t('date_time.time_format')}</AppText>
          <ListGroup>
            {TIMES.map(value => (
              <ListRow
                key={value}
                title={t(`date_time.${value}`)}
                value={value === 'system' ? undefined : EXAMPLES[value]}
                selectionMode="single"
                active={timeFormat === value}
                trailing={<RadioIndicator selected={timeFormat === value} />}
                onPress={() => void setDateTimePreferences({ timeFormat: value })}
              />
            ))}
          </ListGroup>
        </View>
        <View style={{ gap: spacing.sm }}>
          <AppText variant="caption" tone="muted">{t('date_time.date_format')}</AppText>
          <ListGroup>
            {DATES.map(value => (
              <ListRow
                key={value}
                title={t(`date_time.${value}`)}
                value={value === 'system' ? undefined : EXAMPLES[value]}
                selectionMode="single"
                active={dateFormat === value}
                trailing={<RadioIndicator selected={dateFormat === value} />}
                onPress={() => void setDateTimePreferences({ dateFormat: value })}
              />
            ))}
            <CustomDateFormatSetting selected={dateFormat === 'custom'} pattern={customDateFormat} />
          </ListGroup>
        </View>
      </ScrollView>
      <ScreenHeader bordered={scrolled} title={t('date_time.title')} />
    </AppScreen>
  );
}
