import { useCallback, useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useIsFocused, usePreventRemove } from 'expo-router/react-navigation';
import { ForwardTargetScreen } from '@/components/share/ForwardTargetScreen';
import { AppScreen } from '@/components/common/AppScreen';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { useTranslation } from 'react-i18next';
import X from 'lucide-react-native/icons/x';
import Ellipsis from 'lucide-react-native/icons/ellipsis';
import { IconButton } from '@/components/common/IconButton';
import { AppText } from '@/components/common/AppText';
import { AppButton } from '@/components/common/AppButton';
import { NappletIcon } from '@/components/napplet/NappletIcon';
import { useFocusedOverlayDismiss } from '@/components/common/use-focused-overlay-dismiss';
import { spacing, uiDensity, useThemeColors } from '@/theme';
import { NappletSurface } from '@/platform/napplet-surface';
import { nappletService } from '@/services/napplet/service';
import { useNapplets } from '@/stores/napplet.store';

export default function NappletRunScreen() {
  const { running, launching, launch, runId, prompt, configuration, panel, overlayActive, sharing, accountPubkey } = useNapplets();
  const params = useLocalSearchParams<{ runId?: string }>();
  const ownerRunId = params.runId === undefined ? runId : Number(params.runId);
  const ownsRun = ownerRunId === runId;
  const focused = useIsFocused();
  const { t } = useTranslation();
  const c = useThemeColors();
  const closeShare = useCallback(() => { if (accountPubkey && running) nappletService.closeShare(accountPubkey, running.containerId); }, [accountPubkey, running]);
  const clearance = useScreenHeaderClearance();
  const close = useCallback(() => nappletService.stop(ownerRunId), [ownerRunId]);
  const backToApp = useCallback(() => {
    if (!running) { close(); return; }
    void nappletService.goBack().catch((error) => console.warn('[napplet] Back navigation failed', error));
  }, [running, close]);
  useFocusedOverlayDismiss(ownsRun && (!!running || launching || !!launch?.error) && !sharing && !prompt && !configuration && !panel && !overlayActive, backToApp);
  usePreventRemove(focused && ownsRun && !!running, backToApp);
  useFocusEffect(useCallback(() => () => nappletService.stop(ownerRunId), [ownerRunId]));
  useEffect(() => {
    if (!focused || !ownsRun || !launch?.pending) return;
    // Let the container commit before starting downloads, authorization or crypto.
    const timer = setTimeout(() => nappletService.startPreparedOpen(ownerRunId), 0);
    return () => clearTimeout(timer);
  }, [focused, ownsRun, launch?.pending, ownerRunId]);
  useEffect(() => {
    if (focused && ownsRun && !running && !launching && !panel && !launch?.error) router.back();
  }, [running, launching, launch?.error, panel, focused, ownsRun]);
  return (
    <AppScreen edges={['bottom']}>
      <View style={{ flex: 1, display: sharing ? 'none' : 'flex' }}>
      <ScreenHeader title={running?.release.title ?? launch?.release.title ?? panel?.release.title} back={false}
        left={<IconButton icon={<X size={uiDensity.headerActionIconSize} color={c.text} />}
          accessibilityLabel={t('common.close')} onPress={close} />}
        right={
          <IconButton icon={<Ellipsis size={uiDensity.headerActionIconSize} color={c.text} />}
            accessibilityLabel={t('napplets.runtime_more')} onPress={() => nappletService.openPanel('about')} disabled={!running} />
        } />
      <View style={{ flex: 1, paddingTop: clearance }}>
        <View style={{ flex: 1 }}>
        {ownsRun && launch?.showLoading && !launch.error ? (
          <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.lg, backgroundColor: c.background }]}>
            <NappletIcon release={launch.release} />
            <ActivityIndicator color={c.accent} />
            <AppText align="center" tone="muted">{t('napplets.runtime_loading')}</AppText>
          </View>
        ) : null}
        {ownsRun && running ? (
          <NappletSurface id={running.containerId} visible={focused && !sharing} obscured={!!prompt || !!configuration || !!panel || overlayActive} />
        ) : launch?.error && ownsRun ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.lg }}>
            <AppText align="center" tone="muted">{t(launch.error.startsWith('napplets.') ? launch.error : 'napplets.request_failed')}</AppText>
            <AppButton fullWidth={false} label={t('common.retry')} onPress={() => nappletService.retryOpen(ownerRunId)} />
          </View>
        ) : null}
        </View>
      </View>
      </View>
      {sharing ? <ForwardTargetScreen onClose={closeShare} stayInSource /> : null}
    </AppScreen>
  );
}
