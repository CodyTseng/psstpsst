import ChevronDown from 'lucide-react-native/icons/chevron-down';
import { Refresh as RefreshCw } from '@solar-icons/react-native/category/arrows/Linear/Refresh';
import { ClockCircle as Clock3 } from '@solar-icons/react-native/category/time/Linear/ClockCircle';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, type TextInput, View } from 'react-native';

import { ActionRow } from '@/components/common/ActionRow';
import { AppInput } from '@/components/common/AppInput';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { BottomSheet } from '@/components/common/BottomSheet';
import { InputDialog } from '@/components/common/InputDialog';
import { ListGroup } from '@/components/common/ListGroup';
import { ListRow } from '@/components/common/ListRow';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { SectionLabel } from '@/components/common/SectionLabel';
import { Toggle } from '@/components/common/Toggle';
import { IS_ELECTRON } from '@/lib/platform';
import { platform } from '@/platform';
import {
  getKeyRotationSettings,
  isValidKeyRotationIntervalDays,
  MAX_KEY_ROTATION_INTERVAL_DAYS,
  MIN_KEY_ROTATION_INTERVAL_DAYS,
  setKeyRotationSettings,
} from '@/services/dm/encryption-key-rotation-prefs';
import { loadEncryptionKeypair } from '@/services/dm/encryption-key.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { useScrolled } from '@/hooks/use-scrolled';
import { iconStrokeWidth } from '@/theme/icons';
import { spacing, useThemeColors } from '@/theme';

const INTERVAL_SAVE_DELAY_MS = 300;

export default function EncryptionKeySettings() {
  const { scrolled, scrollProps } = useScrolled();
  const { t, i18n } = useTranslation();
  const c = useThemeColors();
  const titleClearance = useScreenHeaderClearance();
  const activePubkey = useActiveAccount((state) => state.activePubkey);
  const resetEncryptionKey = useActiveAccount((state) => state.resetEncryptionKey);
  const [automaticUpdatesEnabled, setAutomaticUpdatesEnabled] = useState<boolean | undefined>(
    undefined,
  );
  const [intervalDays, setIntervalDays] = useState<number | undefined>(undefined);
  const [intervalPickerOpen, setIntervalPickerOpen] = useState(false);
  // The interval is edited as free text everywhere (a dialog on Electron, a
  // sheet on touch); holds the raw digits while typing. Seeded from the stored
  // interval each time the editor opens.
  const [intervalText, setIntervalText] = useState('');
  const [createdAt, setCreatedAt] = useState<number | null | undefined>(undefined);
  const [updating, setUpdating] = useState(false);
  const intervalSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!activePubkey) return;
    void Promise.all([
      getKeyRotationSettings(activePubkey),
      loadEncryptionKeypair(activePubkey),
    ]).then(([settings, keypair]) => {
      setAutomaticUpdatesEnabled(settings.enabled);
      setIntervalDays(settings.intervalDays);
      setCreatedAt(keypair?.createdAt ?? null);
    });
  }, [activePubkey]);

  function chooseInterval(interval: number) {
    const accountPubkey = activePubkey;
    if (!accountPubkey) return;
    setIntervalDays(interval);
    if (intervalSaveTimer.current) clearTimeout(intervalSaveTimer.current);
    intervalSaveTimer.current = setTimeout(() => {
      intervalSaveTimer.current = null;
      void setKeyRotationSettings(accountPubkey, { enabled: true, intervalDays: interval });
    }, INTERVAL_SAVE_DELAY_MS);
  }

  function openIntervalEditor() {
    if (intervalDays === undefined) return;
    setIntervalText(String(intervalDays));
    setIntervalPickerOpen(true);
  }

  function closeIntervalEditor() {
    setIntervalPickerOpen(false);
  }

  // The edit dialog/sheet: an invalid draft (blank, 0, >90) never persists —
  // it just keeps the confirm action disabled.
  function confirmIntervalText() {
    const parsed = Number(intervalText);
    if (!isValidKeyRotationIntervalDays(parsed)) return;
    chooseInterval(parsed);
    setIntervalPickerOpen(false);
  }

  const intervalDraftValid = isValidKeyRotationIntervalDays(Number(intervalText));

  function toggleAutomaticUpdates(enabled: boolean) {
    const accountPubkey = activePubkey;
    if (!accountPubkey || intervalDays === undefined) return;
    if (intervalSaveTimer.current) {
      clearTimeout(intervalSaveTimer.current);
      intervalSaveTimer.current = null;
    }
    setAutomaticUpdatesEnabled(enabled);
    if (!enabled) setIntervalPickerOpen(false);
    void setKeyRotationSettings(accountPubkey, { enabled, intervalDays });
  }

  function confirmUpdate() {
    if (updating) return;
    void platform.confirmationDialog
      .confirm({
        title: t('key_rotation.update_title'),
        message: t('key_rotation.update_message'),
        cancelLabel: t('common.cancel'),
        confirmLabel: t('key_rotation.update_confirm'),
      })
      .then((confirmed) => {
        if (confirmed) void updateNow();
      });
  }

  async function updateNow() {
    if (!activePubkey) return;
    setUpdating(true);
    try {
      await resetEncryptionKey();
      const current = await loadEncryptionKeypair(activePubkey);
      setCreatedAt(current?.createdAt ?? null);
      await platform.confirmationDialog.notify({
        title: t('key_rotation.update_done'),
        okLabel: t('common.ok'),
      });
    } catch {
      await platform.confirmationDialog.notify({
        title: t('key_rotation.update_failed'),
        okLabel: t('common.ok'),
      });
    } finally {
      setUpdating(false);
    }
  }

  const updatedLabel =
    createdAt === undefined
      ? undefined
      : createdAt
        ? new Date(createdAt * 1000).toLocaleDateString(i18n.resolvedLanguage)
        : t('key_rotation.unknown_date');
  const intervalLabel =
    intervalDays === undefined
      ? undefined
      : t('key_rotation.interval_days', { count: intervalDays });

  return (
    <AppScreen edges={[]}>
      <ScrollView
        {...scrollProps}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingTop: titleClearance + spacing.sm,
          paddingBottom: spacing['2xl'],
          gap: spacing.xl,
        }}
      >
        <View style={{ gap: spacing.sm }}>
          <SectionLabel>{t('key_rotation.schedule')}</SectionLabel>
          <ListGroup>
            <ListRow
              title={t('key_rotation.enabled')}
              trailing={
                automaticUpdatesEnabled === undefined ? undefined : (
                  <Toggle
                    value={automaticUpdatesEnabled}
                    onValueChange={toggleAutomaticUpdates}
                  />
                )
              }
              loading={automaticUpdatesEnabled === undefined}
            />
            <ListRow
              title={t('key_rotation.interval')}
              value={intervalLabel}
              trailing={
                intervalDays === undefined ? undefined : (
                  <ChevronDown strokeWidth={iconStrokeWidth.default} size={18} color={c.textMuted} />
                )
              }
              onPress={
                automaticUpdatesEnabled === true && intervalDays !== undefined
                  ? openIntervalEditor
                  : undefined
              }
              loading={intervalDays === undefined}
              disabled={automaticUpdatesEnabled !== true}
            />
          </ListGroup>
          <AppText variant="caption" tone="muted" style={{ paddingHorizontal: spacing.xs }}>
            {t('key_rotation.auto_update_note')}
          </AppText>
        </View>

        <View style={{ gap: spacing.sm }}>
          <SectionLabel>{t('key_rotation.current_key')}</SectionLabel>
          <ListGroup>
            <ListRow
              icon={<Clock3 size={22} color={c.text} />}
              title={t('key_rotation.last_updated')}
              value={updatedLabel}
              loading={createdAt === undefined}
            />
            <ListRow
              icon={<RefreshCw size={22} color={c.text} />}
              title={t('key_rotation.update_now')}
              onPress={confirmUpdate}
              loading={updating}
              disabled={updating}
            />
          </ListGroup>
        </View>

        <View style={{ gap: spacing.sm }}>
          <SectionLabel>{t('key_rotation.protection')}</SectionLabel>
          <AppText variant="caption" tone="muted">
            {t('key_rotation.purpose')}
          </AppText>
        </View>
      </ScrollView>
      <ScreenHeader bordered={scrolled} title={t('key_rotation.title')} />

      {IS_ELECTRON ? (
        // Desktop edits the interval in the centered input dialog — the
        // Electron presentation of the same single-field entry (DESIGN §10).
        <InputDialog
          visible={intervalPickerOpen}
          onClose={closeIntervalEditor}
          actionLayout="horizontal"
          title={t('key_rotation.interval')}
          confirmLabel={t('common.ok')}
          cancelLabel={t('common.cancel')}
          confirmDisabled={!intervalDraftValid}
          onConfirm={confirmIntervalText}
        >
          <AppInput
            description={t('key_rotation.interval_hint', {
              min: MIN_KEY_ROTATION_INTERVAL_DAYS,
              max: MAX_KEY_ROTATION_INTERVAL_DAYS,
            })}
            value={intervalText}
            onChangeText={(text) => setIntervalText(text.replace(/[^0-9]/g, ''))}
            onSubmitEditing={confirmIntervalText}
            keyboardType="number-pad"
            maxLength={2}
            autoFocus
            style={{ textAlign: 'center' }}
          />
        </InputDialog>
      ) : (
        // Touch edits the interval in our own BottomSheet: an auto-focused
        // numeric field (summoning the virtual keyboard) + hint + confirm.
        <BottomSheet
          visible={intervalPickerOpen}
          onClose={closeIntervalEditor}
          inputFocusRef={intervalInputRef}
          title={t('key_rotation.interval')}
          contentStyle={{ gap: spacing.lg }}
        >
          <AppInput
            ref={intervalInputRef}
            description={t('key_rotation.interval_hint', {
              min: MIN_KEY_ROTATION_INTERVAL_DAYS,
              max: MAX_KEY_ROTATION_INTERVAL_DAYS,
            })}
            value={intervalText}
            onChangeText={(text) => setIntervalText(text.replace(/[^0-9]/g, ''))}
            onSubmitEditing={confirmIntervalText}
            keyboardType="number-pad"
            maxLength={2}
            selectTextOnFocus
          />
          <ActionRow
            layout="vertical"
            confirm={{
              label: t('common.ok'),
              disabled: !intervalDraftValid,
              onPress: confirmIntervalText,
            }}
          />
        </BottomSheet>
      )}
    </AppScreen>
  );
}
