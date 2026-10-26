import { connectSigningWindows } from '@/services/signing/changes';
import { useInlineApplicationLaunch } from '@/hooks/use-inline-application-launch';
import { connectApplicationWindows } from '@/services/explore/application-changes';
import { readChangedApplicationMetadata } from '@/services/explore/application-cache';
import { useEffect, useState } from 'react';
import { Stack, ThemeProvider, DarkTheme, DefaultTheme } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { platform } from '@/platform';
import { useActiveAccount } from '@/stores/active-account.store';
import { useThemeStore } from '@/stores/theme.store';
import { useLanguageStore } from '@/stores/language.store';
import { useEffectiveColorScheme, useThemeColors, spacing } from '@/theme';
import { readApplicationWindowLaunch } from '@/services/explore/windows';
import { subscribeExploreVisits } from '@/services/explore/visits';
import { exploreService } from '@/services/explore/service';
import { nappletService } from '@/services/napplet/service';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { AppButton } from '@/components/common/AppButton';
import { ConfirmationDialogHost } from '@/components/common/ConfirmationDialogHost';
import { Toast } from '@/components/common/Toast';
import { NappletOverlays } from './NappletOverlays';

/** A trusted leaf host shares persistence without starting messaging or notification services. */
export function ApplicationWindowRoot() {
  useInlineApplicationLaunch();
  useEffect(() => { connectSigningWindows(platform.napplet.windows); return () => connectSigningWindows(); }, []);
  useEffect(() => { connectApplicationWindows(platform.napplet.windows, readChangedApplicationMetadata); return () => connectApplicationWindows(); }, []);
  useEffect(() => subscribeExploreVisits(visit => {
    void platform.napplet.windows?.action({ type: 'visited', ...visit }).catch(() => {});
  }), []);
  const [ready, setReady] = useState(false), [failed, setFailed] = useState(false);
  const c = useThemeColors(), scheme = useEffectiveColorScheme(), { t } = useTranslation();
  useEffect(() => {
    let active = true;
    void (async () => {
      const { entry, accountPubkey, reviewedRequired } = await readApplicationWindowLaunch();
      await Promise.all([useThemeStore.getState().load(), useLanguageStore.getState().load(), exploreService.activate(accountPubkey)]);
      if (!active) return;
      useActiveAccount.setState({ activePubkey: accountPubkey, status: 'ready' });
      if (entry.release) {
        await nappletService.activateAccount(accountPubkey);
        if (!active) return;
        nappletService.prepareOpen(entry.release, accountPubkey, reviewedRequired);
      }
      else exploreService.prepare(entry, accountPubkey, reviewedRequired);
      setReady(true);
    })().catch(error => { console.warn('[explore] Application window could not start', error); if (active) setFailed(true); });
    return () => { active = false; exploreService.deactivate(); nappletService.deactivate(); };
    // The host has one launch for its lifetime; theme updates are applied separately.
  }, []);
  useEffect(() => { nappletService.updateTheme({ colors: { background: c.background, text: c.text, primary: c.accent } }); }, [c.background, c.text, c.accent]);
  if (!ready) return <AppScreen><View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, padding: spacing.xl }}>
    {failed ? <><AppText>{t('napplets.request_failed')}</AppText><AppButton label={t('common.close')} onPress={() => { void platform.napplet.windows?.close(); }} /></> : <ActivityIndicator color={c.accent} />}
  </View></AppScreen>;
  return <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
    <Stack screenOptions={{ headerShown: false, animation: 'none' }} />
    <NappletOverlays /><ConfirmationDialogHost /><Toast />
  </ThemeProvider>;
}
