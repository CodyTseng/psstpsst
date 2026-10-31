import { formatTime, uses24HourClock, type DateTimeFormatPreferences } from '@/lib/time';
import { useDateTimePreferences } from '@/stores/date-time.store';
import { Host } from '@expo/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { IS_ANDROID, IS_ELECTRON, IS_IOS } from '@/lib/platform';
import { formattingLocale } from '@/lib/locale';
import { spacing, useEffectiveColorScheme, useThemeColors } from '@/theme';

import { ActionRow } from './ActionRow';
import { DesktopTimeOfDayPicker } from './DesktopTimeOfDayPicker';
import { BottomSheet } from './BottomSheet';

// The @expo/ui native views call `requireNativeView` at module scope, which
// throws when merely imported on web — so each native module is required
// lazily, only on its own platform (Metro defers module evaluation until the
// require actually runs).
type IOSWheelsModule = typeof import('./IOSTimeOfDayWheels');
type ComposeModule = typeof import('@expo/ui/jetpack-compose');

/* eslint-disable @typescript-eslint/no-require-imports -- lazy platform-gated native modules, see above */
const iosWheels: IOSWheelsModule | null = IS_IOS ? require('./IOSTimeOfDayWheels') : null;
const compose: ComposeModule | null = IS_ANDROID ? require('@expo/ui/jetpack-compose') : null;
/* eslint-enable @typescript-eslint/no-require-imports */

/** Build a Date on an arbitrary day carrying the given local wall-clock time. */
export function minutesToDate(minutes: number): Date {
  const date = new Date();
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return date;
}

export function dateToMinutes(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

export function formatMinutes(minutes: number, dateTimeFormatPreferences?: DateTimeFormatPreferences): string {
  return formatTime(minutesToDate(minutes).getTime() / 1000, undefined, dateTimeFormatPreferences);
}

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Names the value being edited ("Quiet hours start" / "Quiet hours end"). */
  title: string;
  /** Minutes since local midnight; seeds the editor each time it opens. */
  initialMinutes: number;
  onConfirm: (minutes: number) => void;
};

/**
 * Cross-platform time-of-day editor (DESIGN §8): the native wheel/clock pickers
 * from `@expo/ui` on touch — iOS wheels inside the shared `BottomSheet`,
 * Android's Material `TimePickerDialog` summons itself — and the centered
 * `InputDialog` with separate clock fields and a day-period selector on Electron.
 */
export function TimeOfDayPicker({ visible, onClose, title, initialMinutes, onConfirm }: Props) {
  const { t, i18n } = useTranslation();
  const dateTimeFormatPreferences = useDateTimePreferences();
  const is24Hour = uses24HourClock(dateTimeFormatPreferences);
  const c = useThemeColors();
  const colorScheme = useEffectiveColorScheme();
  const [draftMinutes, setDraftMinutes] = useState(initialMinutes);
  const [seededMinutes, setSeededMinutes] = useState<number | null>(null);

  // Seed the draft each time the editor opens; clear the seed on close so a
  // later open with the same value reseeds. Render-phase adjustment instead of
  // an effect (https://react.dev/learn/you-might-not-need-an-effect).
  if (visible && seededMinutes !== initialMinutes) {
    setSeededMinutes(initialMinutes);
    setDraftMinutes(initialMinutes);
  } else if (!visible && seededMinutes !== null) {
    setSeededMinutes(null);
  }

  function confirmDate(date: Date) {
    onConfirm(dateToMinutes(date));
    onClose();
  }

  if (IS_ELECTRON) {
    return visible ? <DesktopTimeOfDayPicker
      key={initialMinutes}
      title={title}
      initialMinutes={initialMinutes}
      is24Hour={is24Hour}
      locale={formattingLocale(i18n.resolvedLanguage ?? i18n.language, dateTimeFormatPreferences.systemLocale)}
      onClose={onClose}
      onConfirm={onConfirm}
    /> : null;
  }

  if (IS_ANDROID && compose) {
    if (!visible) return null;
    return (
      <Host matchContents colorScheme={colorScheme} seedColor={c.accent}>
        <compose.TimePickerDialog
          initialDate={minutesToDate(initialMinutes).toISOString()}
          is24Hour={is24Hour}
          confirmButtonLabel={t('common.ok')}
          dismissButtonLabel={t('common.cancel')}
          color={c.accent}
          onDateSelected={confirmDate}
          onDismissRequest={onClose}
        />
      </Host>
    );
  }

  if (IS_IOS && iosWheels) {
    return (
      <BottomSheet
        visible={visible}
        onClose={onClose}
        title={title}
        contentStyle={{ gap: spacing.sm }}
      >
        <Host
          matchContents
          colorScheme={colorScheme}
          style={{ alignSelf: 'center' }}
        >
          <iosWheels.IOSTimeOfDayWheels
            minutes={draftMinutes}
            is24Hour={is24Hour}
            locale={formattingLocale(i18n.resolvedLanguage ?? i18n.language, dateTimeFormatPreferences.systemLocale)}
            onChange={setDraftMinutes}
          />
        </Host>
        <ActionRow
          layout="vertical"
          confirm={{ label: t('common.ok'), onPress: () => { onConfirm(draftMinutes); onClose(); } }}
        />
      </BottomSheet>
    );
  }

  return null;
}
