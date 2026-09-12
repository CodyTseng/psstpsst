import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { IS_ANDROID, IS_ELECTRON, IS_IOS } from '@/lib/platform';
import { spacing, useEffectiveColorScheme, useThemeColors } from '@/theme';

import { ActionRow } from './ActionRow';
import { AppInput } from './AppInput';
import { BottomSheet } from './BottomSheet';
import { InputDialog } from './InputDialog';

// The @expo/ui native views call `requireNativeView` at module scope, which
// throws when merely imported on web — so each native module is required
// lazily, only on its own platform (Metro defers module evaluation until the
// require actually runs).
type SwiftUIModule = typeof import('@expo/ui/swift-ui');
type SwiftUIModifiersModule = typeof import('@expo/ui/swift-ui/modifiers');
type ComposeModule = typeof import('@expo/ui/jetpack-compose');

/* eslint-disable @typescript-eslint/no-require-imports -- lazy platform-gated native modules, see above */
const swiftUI: SwiftUIModule | null = IS_IOS ? require('@expo/ui/swift-ui') : null;
const swiftUIModifiers: SwiftUIModifiersModule | null = IS_IOS
  ? require('@expo/ui/swift-ui/modifiers')
  : null;
const compose: ComposeModule | null = IS_ANDROID ? require('@expo/ui/jetpack-compose') : null;
/* eslint-enable @typescript-eslint/no-require-imports */

const TIME_TEXT_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Build a Date on an arbitrary day carrying the given local wall-clock time. */
export function minutesToDate(minutes: number): Date {
  const date = new Date();
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return date;
}

export function dateToMinutes(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

export function formatMinutes(minutes: number, locale: string | undefined): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(
    minutesToDate(minutes),
  );
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
 * `InputDialog` with an HH:MM field on Electron.
 */
export function TimeOfDayPicker({ visible, onClose, title, initialMinutes, onConfirm }: Props) {
  const { t, i18n } = useTranslation();
  const c = useThemeColors();
  const colorScheme = useEffectiveColorScheme();
  const [draftDate, setDraftDate] = useState(() => minutesToDate(initialMinutes));
  const [draftText, setDraftText] = useState('');
  const [seededMinutes, setSeededMinutes] = useState<number | null>(null);

  // Seed the draft each time the editor opens; clear the seed on close so a
  // later open with the same value reseeds. Render-phase adjustment instead of
  // an effect (https://react.dev/learn/you-might-not-need-an-effect).
  if (visible && seededMinutes !== initialMinutes) {
    setSeededMinutes(initialMinutes);
    setDraftDate(minutesToDate(initialMinutes));
    setDraftText(
      `${String(Math.floor(initialMinutes / 60)).padStart(2, '0')}:${String(
        initialMinutes % 60,
      ).padStart(2, '0')}`,
    );
  } else if (!visible && seededMinutes !== null) {
    setSeededMinutes(null);
  }

  function confirmDate(date: Date) {
    onConfirm(dateToMinutes(date));
    onClose();
  }

  const textMatch = TIME_TEXT_PATTERN.exec(draftText);
  const textDraftValid = textMatch !== null;

  function confirmText() {
    if (!textMatch) return;
    onConfirm(Number(textMatch[1]) * 60 + Number(textMatch[2]));
    onClose();
  }

  if (IS_ELECTRON) {
    return (
      <InputDialog
        visible={visible}
        onClose={onClose}
        actionLayout="horizontal"
        title={title}
        confirmLabel={t('common.ok')}
        cancelLabel={t('common.cancel')}
        confirmDisabled={!textDraftValid}
        onConfirm={confirmText}
      >
        <AppInput
          description={t('notifications.dnd_time_hint')}
          value={draftText}
          onChangeText={setDraftText}
          onSubmitEditing={confirmText}
          placeholder="22:00"
          maxLength={5}
          autoFocus
          style={{ textAlign: 'center' }}
        />
      </InputDialog>
    );
  }

  if (IS_ANDROID && compose) {
    if (!visible) return null;
    const hourCycle = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
      hour: 'numeric',
    }).resolvedOptions().hourCycle;

    return (
      <compose.TimePickerDialog
        initialDate={minutesToDate(initialMinutes).toISOString()}
        is24Hour={hourCycle === 'h23' || hourCycle === 'h24'}
        confirmButtonLabel={t('common.ok')}
        dismissButtonLabel={t('common.cancel')}
        color={c.accent}
        onDateSelected={confirmDate}
        onDismissRequest={onClose}
      />
    );
  }

  if (IS_IOS && swiftUI && swiftUIModifiers) {
    return (
      <BottomSheet
        visible={visible}
        onClose={onClose}
        title={title}
        contentStyle={{ gap: spacing.lg }}
      >
        <swiftUI.Host
          matchContents
          colorScheme={colorScheme}
          style={{ alignSelf: 'center' }}
        >
          <swiftUI.DatePicker
            selection={draftDate}
            displayedComponents={['hourAndMinute']}
            onDateChange={setDraftDate}
            modifiers={[swiftUIModifiers.datePickerStyle('wheel')]}
          />
        </swiftUI.Host>
        <ActionRow
          layout="vertical"
          confirm={{ label: t('common.ok'), onPress: () => confirmDate(draftDate) }}
        />
      </BottomSheet>
    );
  }

  return null;
}
