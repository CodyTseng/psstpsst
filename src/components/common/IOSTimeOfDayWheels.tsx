import { HStack, Picker, Text } from '@expo/ui/swift-ui';
import { accessibilityLabel, clipped, contentShape, frame, labelsHidden, pickerStyle, shapes, tag } from '@expo/ui/swift-ui/modifiers';
import { useMemo, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

import { spacing } from '@/theme';

type Props = {
  minutes: number;
  is24Hour: boolean;
  locale: string;
  onChange: Dispatch<SetStateAction<number>>;
};

const HOURS_24 = Array.from({ length: 24 }, (_, hour) => hour);
const HOURS_12 = Array.from({ length: 12 }, (_, hour) => hour + 1);
const MINUTES = Array.from({ length: 60 }, (_, minute) => minute);

/** Explicit native wheel options keep OS clock overrides out of app-selected formats. */
export function IOSTimeOfDayWheels({ minutes, is24Hour, locale, onChange }: Props) {
  const { t } = useTranslation();
  const hour = Math.floor(minutes / 60);
  const presentation = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, { hour: 'numeric', hourCycle: 'h12' });
    const amParts = formatter.formatToParts(new Date(2020, 0, 15, 6));
    return {
      number: new Intl.NumberFormat(locale, { useGrouping: false, minimumIntegerDigits: 2 }),
      hour: new Intl.NumberFormat(locale, { useGrouping: false }),
      am: amParts.find(part => part.type === 'dayPeriod')?.value ?? 'AM',
      pm: formatter.formatToParts(new Date(2020, 0, 15, 18)).find(part => part.type === 'dayPeriod')?.value ?? 'PM',
      periodFirst: amParts.findIndex(part => part.type === 'dayPeriod') < amParts.findIndex(part => part.type === 'hour'),
    };
  }, [locale]);
  const wheelModifiers = (width = spacing['3xl'] + spacing['2xl']) => [pickerStyle('wheel'), labelsHidden(), frame({ width }), clipped(), contentShape(shapes.rectangle())];
  const period = !is24Hour ? <Picker
    key="period"
    label={`${presentation.am} / ${presentation.pm}`}
    selection={hour < 12 ? 0 : 1}
    onSelectionChange={(value: number) => onChange(previous => (Math.floor(previous / 60) % 12 + value * 12) * 60 + previous % 60)}
    modifiers={wheelModifiers(spacing['3xl'] * 2)}
  >
    <Text modifiers={[tag(0)]}>{presentation.am}</Text>
    <Text modifiers={[tag(1)]}>{presentation.pm}</Text>
  </Picker> : null;

  return <HStack spacing={0}>
    {presentation.periodFirst ? period : null}
    <Picker
      key={is24Hour ? 'hour24' : 'hour12'}
      label={t('date_time.hour')}
      selection={is24Hour ? hour : hour % 12 || 12}
      onSelectionChange={(value: number) => onChange(previous => {
        const nextHour = is24Hour ? value : value % 12 + (Math.floor(previous / 60) >= 12 ? 12 : 0);
        return nextHour * 60 + previous % 60;
      })}
      modifiers={[...wheelModifiers(), accessibilityLabel(t('date_time.hour'))]}
    >
      {(is24Hour ? HOURS_24 : HOURS_12).map(value => <Text key={value} modifiers={[tag(value)]}>
        {(is24Hour ? presentation.number : presentation.hour).format(value)}
      </Text>)}
    </Picker>
    <Picker
      key="minute"
      label={t('date_time.minute')}
      selection={minutes % 60}
      onSelectionChange={(value: number) => onChange(previous => Math.floor(previous / 60) * 60 + value)}
      modifiers={[...wheelModifiers(), accessibilityLabel(t('date_time.minute'))]}
    >
      {MINUTES.map(value => <Text key={value} modifiers={[tag(value)]}>{presentation.number.format(value)}</Text>)}
    </Picker>
    {!presentation.periodFirst ? period : null}
  </HStack>;
}
