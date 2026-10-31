import Check from 'lucide-react-native/icons/check';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type TextInput, type TextInputProps } from 'react-native';

import { parseTimeOfDay } from '@/lib/time';
import { radius, spacing, uiDensity, useThemeColors } from '@/theme';

import { AppInput } from './AppInput';
import { InputDialog } from './InputDialog';
import { AppText } from './AppText';
import { AppButton } from './AppButton';
import { ContextMenuOverlay, type ContextMenuAnchor } from './ContextMenu';
import { useFocusedOverlayDismiss } from './use-focused-overlay-dismiss';

type Draft = { hour: string; minute: string; period: 'am' | 'pm' };
type Props = {
  title: string;
  initialMinutes: number;
  is24Hour: boolean;
  locale: string;
  onClose(): void;
  onConfirm(minutes: number): void;
};

function draftFor(minutes: number, is24Hour: boolean): Draft {
  const hour = Math.floor(minutes / 60);
  return {
    hour: is24Hour ? String(hour).padStart(2, '0') : String(hour % 12 || 12),
    minute: String(minutes % 60).padStart(2, '0'),
    period: hour < 12 ? 'am' : 'pm',
  };
}

function draftMinutes(draft: Draft, is24Hour: boolean): number | null {
  if (!draft.hour || !draft.minute) return null;
  return parseTimeOfDay(`${draft.hour}:${draft.minute.padStart(2, '0')}${is24Hour ? '' : ` ${draft.period.toUpperCase()}`}`, is24Hour);
}

/** A segmented clock editor; draft changes never reach the saved quiet-hours window. */
export function DesktopTimeOfDayPicker({ title, initialMinutes, is24Hour, locale, onClose, onConfirm }: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const periodRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<ContextMenuAnchor | null>(null);
  const closeMenu = useCallback(() => setAnchor(null), []);
  useFocusedOverlayDismiss(anchor != null, closeMenu);
  const [draft, setDraft] = useState(() => draftFor(initialMinutes, is24Hour));
  const [clockMode, setClockMode] = useState(is24Hour);
  const minuteRef = useRef<TextInput>(null);
  if (clockMode !== is24Hour) {
    setClockMode(is24Hour);
    setDraft(draftFor(draftMinutes(draft, clockMode) ?? initialMinutes, is24Hour));
  }
  const minutes = draftMinutes(draft, is24Hour);
  const periodOptions = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, { hour: 'numeric', hourCycle: 'h12' });
    const period = (hour: number, fallback: string) => formatter.formatToParts(new Date(2020, 0, 15, hour))
      .find(part => part.type === 'dayPeriod')?.value ?? fallback;
    return [{ value: 'am' as const, label: period(6, 'AM') }, { value: 'pm' as const, label: period(18, 'PM') }];
  }, [locale]);

  function confirm() {
    if (minutes == null) return;
    onConfirm(minutes);
    onClose();
  }

  function keyPress(step: number): TextInputProps['onKeyPress'] {
    return event => {
      const key = event.nativeEvent.key;
      if (key !== 'ArrowUp' && key !== 'ArrowDown') return;
      event.preventDefault();
      const next = ((minutes ?? initialMinutes) + (key === 'ArrowUp' ? step : -step) + 1440) % 1440;
      setDraft(draftFor(next, is24Hour));
    };
  }

  const periodFirst = useMemo(() => {
    const parts = new Intl.DateTimeFormat(locale, { hour: 'numeric', hourCycle: 'h12' }).formatToParts(new Date(2020, 0, 15, 6));
    return parts.findIndex(part => part.type === 'dayPeriod') < parts.findIndex(part => part.type === 'hour');
  }, [locale]);
  const dayPeriod = !is24Hour ? <View ref={periodRef} collapsable={false} style={{ flexShrink: 0 }}>
    <AppButton
      label={periodOptions.find(option => option.value === draft.period)!.label}
      variant="ghost" size="sm" labelVariant="subtitle" fullWidth={false}
      accessibilityState={{ expanded: anchor != null }}
      iconRight={<ChevronDown size={spacing.md} color={c.textMuted} />}
      onPress={() => periodRef.current?.measureInWindow((x, y, width, height) => setAnchor({ x, y, width, height }))}
    />
  </View> : null;
  const hour = Number(draft.hour);
  const hourValid = draft.hour !== '' && hour >= (is24Hour ? 0 : 1) && hour <= (is24Hour ? 23 : 12);
  const minuteValid = draft.minute !== '' && Number(draft.minute) <= 59;
  return <InputDialog
    visible
    onClose={onClose}
    actionLayout="horizontal"
    title={title}
    confirmLabel={t('common.ok')}
    cancelLabel={t('common.cancel')}
    confirmDisabled={minutes == null}
    onConfirm={confirm}
    overlay={anchor ? <ContextMenuOverlay anchor={anchor} onClose={closeMenu}
      items={periodOptions.map(option => ({ key: option.value, title: option.label,
        icon: <Check size={spacing.lg} color={c.accent} style={{ opacity: draft.period === option.value ? 1 : 0 }} />,
        selected: draft.period === option.value,
        onPress: () => setDraft(previous => ({ ...previous, period: option.value })),
      }))} /> : null}
  >
    <View style={{ alignItems: 'center' }}>
      <View style={{ flexDirection: 'row', direction: 'ltr', alignItems: 'center', padding: spacing.xs,
        borderWidth: 1, borderColor: c.border, borderRadius: radius.lg, backgroundColor: c.surfaceMuted,
        minHeight: uiDensity.inputHeight + spacing.sm }}>
        {periodFirst ? dayPeriod : null}
        <View style={{ width: spacing['3xl'], flexShrink: 0 }}>
          <AppInput
            variant="segment"
            tabIndex={0}
            accessibilityLabel={t('date_time.hour')}
            style={{ textAlign: 'center', writingDirection: 'ltr', fontVariant: ['tabular-nums'] }}
            value={draft.hour}
            onChangeText={value => setDraft(previous => ({ ...previous, hour: value.replace(/\D/g, '').slice(0, 2) }))}
            onBlur={() => { if (hourValid) setDraft(previous => ({ ...previous, hour: is24Hour ? String(hour).padStart(2, '0') : String(hour) })); }}
            invalid={draft.hour !== '' && !hourValid}
            onKeyPress={keyPress(60)}
            onSubmitEditing={() => minuteRef.current?.focus()}
            returnKeyType="next"
            inputMode="numeric"
            maxLength={2}
            selectTextOnFocus
            autoFocus
          />
        </View>
        <AppText variant="title" tone="muted">:</AppText>
        <View style={{ width: spacing['3xl'], flexShrink: 0 }}>
          <AppInput
            ref={minuteRef}
            variant="segment"
            tabIndex={0}
            accessibilityLabel={t('date_time.minute')}
            style={{ textAlign: 'center', writingDirection: 'ltr', fontVariant: ['tabular-nums'] }}
            value={draft.minute}
            onChangeText={value => setDraft(previous => ({ ...previous, minute: value.replace(/\D/g, '').slice(0, 2) }))}
            onBlur={() => { if (minuteValid) setDraft(previous => ({ ...previous, minute: previous.minute.padStart(2, '0') })); }}
            invalid={draft.minute !== '' && !minuteValid}
            onKeyPress={keyPress(1)}
            onSubmitEditing={confirm}
            returnKeyType="done"
            inputMode="numeric"
            maxLength={2}
            selectTextOnFocus
          />
        </View>
        {!periodFirst ? dayPeriod : null}
      </View>
    </View>
    {(!hourValid && draft.hour !== '') || (!minuteValid && draft.minute !== '') ?
      <AppText variant="caption" tone="danger">{!hourValid ? `${t('date_time.hour')}: ${is24Hour ? '00–23' : '1–12'}` : `${t('date_time.minute')}: 00–59`}</AppText> : null}
  </InputDialog>;
}
