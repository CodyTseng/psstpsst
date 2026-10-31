import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TextInput } from 'react-native';

import { ActionRow } from '@/components/common/ActionRow';
import { AppInput } from '@/components/common/AppInput';
import { AppText } from '@/components/common/AppText';
import { BottomSheet } from '@/components/common/BottomSheet';
import { InputDialog } from '@/components/common/InputDialog';
import { ListRow } from '@/components/common/ListRow';
import { RadioIndicator } from '@/components/common/radio-indicator';
import { formatCustomDate, MAX_CUSTOM_DATE_FORMAT_LENGTH, normalizeCustomDateFormat } from '@/lib/date-format';
import { IS_ELECTRON } from '@/lib/platform';
import { setDateTimePreferences } from '@/services/preferences/date-time-preferences';
import { spacing } from '@/theme';

const EXAMPLE_DATE = new Date(2026, 0, 5);

/** Draft edits stay local; only Save changes date displays elsewhere in the app. */
export function CustomDateFormatSetting({ selected, pattern }: { selected: boolean; pattern: string }) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [draft, setDraft] = useState(pattern);
  const [invalid, setInvalid] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const close = () => setVisible(false);
  const normalized = normalizeCustomDateFormat(draft);

  function save() {
    if (normalized == null) {
      setInvalid(true);
      return;
    }
    void setDateTimePreferences({ dateFormat: 'custom', customDateFormat: normalized });
    close();
  }

  const fields = <>
    <AppInput
      ref={inputRef}
      label={t('date_time.date_format')}
      description={t('date_time.custom_hint')}
      error={invalid ? t('date_time.custom_invalid') : undefined}
      placeholder="YYYY/MM/DD"
      value={draft}
      onChangeText={value => { setDraft(value); setInvalid(false); }}
      autoCapitalize="none"
      autoCorrect={false}
      autoFocus={IS_ELECTRON}
      maxLength={MAX_CUSTOM_DATE_FORMAT_LENGTH}
      returnKeyType="done"
      onSubmitEditing={save}
    />
    <AppText variant="caption" tone="muted">
      {normalized != null
        ? t('date_time.preview', { date: formatCustomDate(EXAMPLE_DATE, normalized) })
        : '\u00a0'}
    </AppText>
  </>;

  return <>
    <ListRow
      title={t('date_time.custom')}
      value={formatCustomDate(EXAMPLE_DATE, pattern)}
      selectionMode="single"
      active={selected}
      trailing={<RadioIndicator selected={selected} />}
      onPress={() => { setDraft(pattern); setInvalid(false); setVisible(true); }}
    />
    {IS_ELECTRON ? <InputDialog
      visible={visible}
      onClose={close}
      title={t('date_time.custom')}
      actionLayout="horizontal"
      cancelLabel={t('common.cancel')}
      confirmLabel={t('common.save')}
      onConfirm={save}
    >{fields}</InputDialog> : <BottomSheet
      visible={visible}
      onClose={close}
      title={t('date_time.custom')}
      inputFocusRef={inputRef}
      contentStyle={{ gap: spacing.lg }}
    >
      {fields}
      <ActionRow layout="vertical" confirm={{ label: t('common.save'), onPress: save }} />
    </BottomSheet>}
  </>;
}
