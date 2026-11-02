import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, View } from 'react-native';

import type { WindowAppearance } from '@/platform/ports/window-chrome';
import { platform, type AppUpdateStatus } from '@/platform';
import { useThemeStore } from '@/stores/theme.store';
import { useLanguageStore } from '@/stores/language.store';
import { desktopUtility, radius, spacing, useThemeColors } from '@/theme';
import { formatFileSize } from '@/lib/nostr/file-tags';
import { ActionRow } from './ActionRow';
import { AppButton } from './AppButton';
import { AppProgressBar } from './AppProgressBar';
import { AppScreen } from './AppScreen';
import { AppText } from './AppText';
import { AppUpdateReleaseNotes } from './AppUpdateReleaseNotes';

/** The update leaf loads device appearance and language without starting account services. */
export function AppUpdateWindowRoot() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    let latestAppearance: WindowAppearance | null = null;
    let initialized = false;
    const removeAppearance = platform.windowChrome.addAppearanceListener(appearance => {
      latestAppearance = appearance;
      if (initialized) useThemeStore.getState().applyAppearance(appearance);
    });
    const load = async () => {
      const [, , appearance] = await Promise.all([
        useThemeStore.getState().load(), useLanguageStore.getState().load(),
        platform.windowChrome.getAppearance(),
      ]);
      if (!active) return;
      const current = latestAppearance ?? appearance;
      if (current) useThemeStore.getState().applyAppearance(current);
      initialized = true;
      setReady(true);
    };
    void load();
    const remove = platform.windowChrome.addFocusListener(focused => { if (focused) void load(); });
    return () => { active = false; remove(); removeAppearance(); };
  }, []);
  return ready ? <Stack screenOptions={{ headerShown: false, animation: 'none' }} /> : <AppScreen><View style={{ flex: 1 }} /></AppScreen>;
}

export function AppUpdateWindowScreen() {
  const { t } = useTranslation();
  const c = useThemeColors();
  const [status, setStatus] = useState<AppUpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);

  useEffect(() => {
    active.current = true;
    let receivedEvent = false;
    const receive = (next: AppUpdateStatus) => {
      setStatus(next);
      if (next.state === 'idle' || next.state === 'checking') void platform.appUpdate.closeWindow();
    };
    const remove = platform.appUpdate.addStatusListener(next => { receivedEvent = true; receive(next); });
    void platform.appUpdate.getStatus().then(next => {
      if (active.current && !receivedEvent) receive(next);
    }).catch(() => { if (active.current) setError('app_update.status_failed'); });
    return () => { active.current = false; remove(); };
  }, []);

  async function run(action: () => Promise<unknown>, failure: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { await action(); }
    catch { if (active.current) setError(failure); }
    finally { if (active.current) setBusy(false); }
  }

  const close = () => { void platform.appUpdate.closeWindow(); };
  const release = status && 'version' in status ? status : null;
  const downloading = status?.state === 'downloading' ? status : null;
  const failed = status?.state === 'error' ? status : null;
  const ready = status?.state === 'downloaded' || (failed?.phase === 'install');
  const installing = status?.state === 'installing';
  const title = failed ? `app_update.${failed.phase === 'download' ? 'download_failed_title' : 'install_failed_title'}`
    : downloading ? 'app_update.downloading_title' : installing ? 'app_update.installing'
    : ready ? 'app_update.ready_title' : 'app_update.available_heading';
  const message = failed ? `app_update.${failed.phase === 'download' ? 'download_failed_message' : 'install_failed_message'}`
    : downloading ? (downloading.percent >= 100 ? 'app_update.preparing' : 'app_update.download_hint')
    : installing ? 'app_update.installing_message' : ready ? 'app_update.ready_hint' : null;
  const localError = error && !(failed && (error === 'app_update.download_failed_message' || error === 'app_update.install_failed_message')) ? error : null;

  return <AppScreen>
    <View style={{ flex: 1, flexDirection: 'row', padding: spacing.xl, gap: spacing.xl }}>
      <Image source={require('@/assets/images/icon.png')} contentFit="contain" accessibilityLabel="PsstPsst"
        style={{ width: desktopUtility.iconSize, height: desktopUtility.iconSize, borderRadius: radius.lg }} />
      <View style={{ flex: 1, minWidth: 0, gap: spacing.lg }}>
        {release ? <>
          <View style={{ gap: spacing.sm }}>
            <AppText variant="subtitle" weight="bold" accessibilityRole="header">{t(title)}</AppText>
            <AppText>{t('app_update.version_summary', {
              version: release.version, currentVersion: Constants.expoConfig?.version ?? '',
            })}</AppText>
            {release.preview ? <AppText variant="caption" tone="muted">{t('app_update.preview_message')}</AppText> : null}
            {message ? <AppText tone={failed ? 'danger' : 'muted'} accessibilityLiveRegion="polite">{t(message)}</AppText> : null}
          </View>
          {downloading ? <View style={{ gap: spacing.sm }}>
            <AppProgressBar value={downloading.percent / 100} label={t('app_update.downloading', { version: release.version })} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
              <AppText variant="caption" tone="muted">{(downloading.total ?? 0) > 0 ? t('app_update.download_progress', {
                percent: Math.floor(downloading.percent),
                transferred: formatFileSize(downloading.transferred) ?? '0 B', total: formatFileSize(downloading.total),
              }) : `${Math.floor(downloading.percent)}%`}</AppText>
              {(downloading.bytesPerSecond ?? 0) > 0 ? <AppText variant="caption" tone="muted">{t('app_update.download_speed', { speed: formatFileSize(downloading.bytesPerSecond) })}</AppText> : null}
            </View>
          </View> : null}
          <View style={{ flex: 1, minHeight: 0, gap: spacing.sm }}>
            <AppText variant="body" weight="semibold">{t('app_update.release_notes')}</AppText>
            <ScrollView accessibilityLabel={t('app_update.release_notes')} style={{ flex: 1, borderWidth: 1, borderColor: c.border,
              backgroundColor: c.surfaceMuted, borderRadius: radius.xs }} contentContainerStyle={{ padding: spacing.md, gap: spacing.lg }}>
              <AppUpdateReleaseNotes version={release.version} note={release.releaseNotes} changelog={release.changelog} />
              <AppButton label={t('app_update.release_history')} variant="accentText" onPress={() => {
                void run(async () => {
                  if (!(await platform.urlOpener.openExternalUrl('https://github.com/codytseng/psstpsst/releases'))) throw new Error('Unable to open release history');
                }, 'app_update.open_release_history_failed');
              }} />
            </ScrollView>
          </View>
        </> : !error ? <ActivityIndicator color={c.accent} /> : null}
        {localError ? <AppText tone="danger" accessibilityRole="alert">{t(localError)}</AppText> : null}
        {failed ? <AppButton label={t('app_update.open_downloads')} variant="accentText" onPress={() => {
          void run(async () => {
            if (!(await platform.urlOpener.openExternalUrl('https://github.com/codytseng/psstpsst/releases/latest'))) throw new Error('Unable to open downloads');
          }, 'app_update.open_downloads_failed');
        }} /> : null}
        {release && !downloading && !installing ? <ActionRow layout="horizontal" size="sm" compact
          auxiliary={status?.state === 'available' ? {
            label: t('app_update.skip_version'), disabled: busy,
            onPress: () => { void run(() => platform.appUpdate.skipVersion(), 'app_update.skip_failed'); },
          } : undefined}
          dismiss={{ label: t('app_update.later_reminder'), onPress: close, disabled: busy }}
          confirm={{ label: t(ready ? 'app_update.restart_and_install' : failed ? 'common.retry' : 'app_update.download'), loading: busy,
            onPress: () => { void run(
              () => ready ? platform.appUpdate.install() : platform.appUpdate.download(),
              ready ? 'app_update.install_failed_message' : 'app_update.download_failed_message',
            ); } }} />
          : !installing ? <ActionRow layout="horizontal" size="sm" compact confirm={{ label: t(downloading ? 'app_update.download_in_background' : 'common.close'), onPress: close }} /> : null}
      </View>
    </View>
  </AppScreen>;
}
