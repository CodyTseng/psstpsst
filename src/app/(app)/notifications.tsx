import { Bell } from '@solar-icons/react-native/category/notifications/Linear/Bell';
import { MoonSleep } from '@solar-icons/react-native/category/weather/Linear/MoonSleep';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, ScrollView, View } from 'react-native';

import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { ListGroup } from '@/components/common/ListGroup';
import { ListRow } from '@/components/common/ListRow';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { formatMinutes, TimeOfDayPicker } from '@/components/common/TimeOfDayPicker';
import { Toggle } from '@/components/common/Toggle';
import { IS_ANDROID, IS_ELECTRON, IS_IOS } from '@/lib/platform';
import { platform } from '@/platform';
import { notificationService } from '@/services/notifications/notification.service';
import {
  DEFAULT_DND_WINDOW,
  DEFAULT_NOTIFICATION_CONTENT_PREFERENCES,
  type DndWindow,
  type NotificationContentPreferences,
} from '@/services/notifications/notification-prefs';
import { useScrolled } from '@/hooks/use-scrolled';
import { spacing, useThemeColors } from '@/theme';

const DELIVERY_NOTE_KEY = IS_IOS
  ? 'notifications.delivery_note_ios'
  : IS_ANDROID
    ? 'notifications.delivery_note_android'
    : 'notifications.delivery_note_desktop';

/**
 * Notifications settings. Delivery permission and privacy-sensitive preview
 * details are controlled at the device level.
 */
export default function NotificationsSettings() {
  const { scrolled, scrollProps } = useScrolled();
  const { t, i18n } = useTranslation();
  const c = useThemeColors();
  const titleClearance = useScreenHeaderClearance();
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [contentPreferences, setContentPreferences] =
    useState<NotificationContentPreferences | null>(null);
  const [savingContentPreference, setSavingContentPreference] = useState<
    keyof NotificationContentPreferences | null
  >(null);
  const [dndWindow, setDndWindow] = useState<DndWindow | null>(null);
  const [savingDnd, setSavingDnd] = useState(false);
  const [editingDndField, setEditingDndField] = useState<'start' | 'end' | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      notificationService.getStatus(),
      notificationService.getContentPreferences(),
      notificationService.getDndWindow(),
    ])
      .then(([status, preferences, dnd]) => {
        if (!active) return;
        setEnabled(status.enabled && status.granted);
        setContentPreferences(preferences);
        setDndWindow(dnd);
      })
      .catch((error) => {
        console.warn('[notifications] Unable to load notification settings.', error);
        if (!active) return;
        setContentPreferences(DEFAULT_NOTIFICATION_CONTENT_PREFERENCES);
        setDndWindow(DEFAULT_DND_WINDOW);
      });
    return () => {
      active = false;
    };
  }, []);

  async function onToggle(next: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      if (next) {
        const status = await notificationService.enable();
        if (!status.granted) {
          // OS permission denied — can't enable. Native: point the user to the
          // system settings page (urlOpener has no app-settings concept, so RN
          // Linking stays for this one native-only link). Desktop has no such
          // page — just explain the denial.
          if (IS_ELECTRON) {
            void platform.confirmationDialog.notify({
              title: t('notifications.unavailable_title'),
              message: t('notifications.unavailable_message'),
              okLabel: t('common.ok'),
            });
          } else {
            void platform.confirmationDialog
              .confirm({
                title: t('notifications.permission_denied_title'),
                message: t('notifications.permission_denied_message'),
                cancelLabel: t('common.cancel'),
                confirmLabel: t('notifications.open_settings'),
              })
              .then((confirmed) => {
                if (confirmed) void Linking.openSettings();
              });
          }
          setEnabled(false);
          return;
        }
        setEnabled(true);
      } else {
        await notificationService.disable();
        setEnabled(false);
      }
    } finally {
      setBusy(false);
    }
  }

  async function onContentPreferenceToggle(
    key: keyof NotificationContentPreferences,
    value: boolean,
  ) {
    if (savingContentPreference || !contentPreferences) return;
    const previous = contentPreferences;
    const next = { ...previous, [key]: value };
    setContentPreferences(next);
    setSavingContentPreference(key);
    try {
      await notificationService.setContentPreferences(next);
    } catch {
      setContentPreferences(previous);
    } finally {
      setSavingContentPreference(null);
    }
  }

  async function onDndToggle(next: boolean) {
    if (savingDnd || !dndWindow) return;
    const previous = dndWindow;
    const updated = { ...previous, enabled: next };
    setDndWindow(updated);
    setSavingDnd(true);
    if (!next) setEditingDndField(null);
    try {
      await notificationService.setDndWindow(updated);
    } catch {
      setDndWindow(previous);
    } finally {
      setSavingDnd(false);
    }
  }

  async function onDndTimeConfirm(minutes: number) {
    if (!dndWindow || !editingDndField) return;
    const previous = dndWindow;
    const updated =
      editingDndField === 'start'
        ? { ...previous, startMinutes: minutes }
        : { ...previous, endMinutes: minutes };
    setDndWindow(updated);
    setSavingDnd(true);
    try {
      await notificationService.setDndWindow(updated);
    } catch {
      setDndWindow(previous);
    } finally {
      setSavingDnd(false);
    }
  }

  return (
    <AppScreen edges={[]}>
      <ScrollView
        {...scrollProps}
        contentContainerStyle={{
          padding: spacing.lg,
          paddingTop: titleClearance + spacing.sm,
          gap: spacing.lg,
        }}
      >
        <View style={{ gap: spacing.sm }}>
          <ListGroup>
            <ListRow
              icon={<Bell size={22} color={c.text} />}
              title={t('notifications.enable_label')}
              trailing={<Toggle value={enabled} onValueChange={onToggle} disabled={busy} />}
            />
          </ListGroup>
          <AppText variant="caption" tone="muted" style={{ paddingHorizontal: spacing.xs }}>
            {t(DELIVERY_NOTE_KEY)}
          </AppText>
        </View>
        <View style={{ gap: spacing.sm }}>
          <ListGroup>
            <ListRow
              title={t('notifications.show_sender')}
              loading={!contentPreferences}
              trailing={
                contentPreferences ? (
                  <Toggle
                    value={contentPreferences.showSender}
                    onValueChange={(value) => onContentPreferenceToggle('showSender', value)}
                    disabled={savingContentPreference !== null}
                  />
                ) : undefined
              }
            />
            <ListRow
              title={t('notifications.show_message_content')}
              loading={!contentPreferences}
              trailing={
                contentPreferences ? (
                  <Toggle
                    value={contentPreferences.showMessageContent}
                    onValueChange={(value) =>
                      onContentPreferenceToggle('showMessageContent', value)
                    }
                    disabled={savingContentPreference !== null}
                  />
                ) : undefined
              }
            />
          </ListGroup>
          <AppText variant="caption" tone="muted" style={{ paddingHorizontal: spacing.xs }}>
            {t('notifications.privacy_note')}
          </AppText>
        </View>
        <View style={{ gap: spacing.sm }}>
          <ListGroup>
            <ListRow
              icon={<MoonSleep size={22} color={c.text} />}
              title={t('notifications.dnd_label')}
              loading={!dndWindow}
              trailing={
                dndWindow ? (
                  <Toggle
                    value={dndWindow.enabled}
                    onValueChange={onDndToggle}
                    disabled={savingDnd}
                  />
                ) : undefined
              }
            />
            <ListRow
              title={t('notifications.dnd_from')}
              value={
                dndWindow
                  ? formatMinutes(dndWindow.startMinutes, i18n.resolvedLanguage)
                  : undefined
              }
              onPress={dndWindow?.enabled ? () => setEditingDndField('start') : undefined}
              loading={!dndWindow}
              disabled={!dndWindow?.enabled}
            />
            <ListRow
              title={t('notifications.dnd_to')}
              value={
                dndWindow ? formatMinutes(dndWindow.endMinutes, i18n.resolvedLanguage) : undefined
              }
              onPress={dndWindow?.enabled ? () => setEditingDndField('end') : undefined}
              loading={!dndWindow}
              disabled={!dndWindow?.enabled}
            />
          </ListGroup>
          <AppText variant="caption" tone="muted" style={{ paddingHorizontal: spacing.xs }}>
            {t('notifications.dnd_note')}
          </AppText>
        </View>
      </ScrollView>
      <ScreenHeader bordered={scrolled} title={t('notifications.title')} />
      <TimeOfDayPicker
        visible={editingDndField !== null}
        onClose={() => setEditingDndField(null)}
        title={
          editingDndField === 'end'
            ? t('notifications.dnd_edit_end_title')
            : t('notifications.dnd_edit_start_title')
        }
        initialMinutes={
          editingDndField === 'end'
            ? (dndWindow?.endMinutes ?? DEFAULT_DND_WINDOW.endMinutes)
            : (dndWindow?.startMinutes ?? DEFAULT_DND_WINDOW.startMinutes)
        }
        onConfirm={onDndTimeConfirm}
      />
    </AppScreen>
  );
}
