import { useNappletShare } from '@/hooks/use-napplet-share';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { router } from 'expo-router';
import { Widget } from '@solar-icons/react-native/category/settings/Linear/Widget';
import Plus from 'lucide-react-native/icons/plus';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getBottomChromeInset } from '@/lib/layout/bottom-chrome';
import { AppScreen } from '@/components/common/AppScreen';
import { AppButton } from '@/components/common/AppButton';
import { AppText } from '@/components/common/AppText';
import { IconButton } from '@/components/common/IconButton';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { NappletGrid } from '@/components/napplet/NappletGrid';
import { nappletService } from '@/services/napplet/service';
import { desktopApps, recentApps } from '@/services/napplet/desktop-order';
import type { NappletInstallation } from '@/services/napplet/protocol';
import { useNapplets } from '@/stores/napplet.store';
import { useActiveAccount } from '@/stores/active-account.store';
import { usePrimaryPaneNavigation } from '@/components/navigation/primary-pane-navigation';
import { iconStrokeWidth } from '@/theme/icons';
import { bottomBarHeight, spacing, uiDensity, useThemeColors } from '@/theme';

export default function NappletsScreen() {
  const account = useActiveAccount((s) => s.activePubkey);
  return <AccountNapplets key={account ?? 'signed-out'} account={account} />;
}
function AccountNapplets({ account }: { account: string | null }) {
  const c = useThemeColors();
  const { t } = useTranslation();
  const state = useNapplets();
  const share = useNappletShare(account);
  const navigation = usePrimaryPaneNavigation();
  const desktop = useMemo(() => desktopApps(state.installed), [state.installed]);
  const recent = useMemo(() => recentApps(state.installed), [state.installed]);
  const [scrolled, setScrolled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clearance = useScreenHeaderClearance();
  const bottomInset = bottomBarHeight + getBottomChromeInset(useSafeAreaInsets().bottom);
  useEffect(() => {
    if (account)
      void nappletService.activate(account).catch(() => setError('napplets.request_failed'));
  }, [account]);
  const open = useCallback(
    (app: NappletInstallation) => {
      setError(null);
      try {
        const runId = nappletService.prepareOpen(app, account ?? '');
        navigation.open(`/napplet-run?runId=${runId}`);
      } catch {
        setError('napplets.request_failed');
      }
    },
    [account, navigation],
  );
  const action = useCallback(
    (app: NappletInstallation, index: number | null) => {
      setError(null);
      return nappletService
        .moveDesktop(app.key, index, account ?? '')
        .catch(() => setError('napplets.request_failed'));
    },
    [account],
  );
  return (
    <AppScreen edges={[]}>
      <ScreenHeader
        back={false}
        bordered={scrolled}
        title={t('napplets.title')}
        right={
          <IconButton variant="plain" size={uiDensity.headerActionSize}
            icon={<Plus strokeWidth={iconStrokeWidth.default} size={uiDensity.headerActionIconSize} color={c.text} />}
            accessibilityLabel={t('napplets.install_link')}
            onPress={() => router.push('/napplet-install')}
          />
        }
      />
      <View style={{ flex: 1, paddingTop: clearance }}>
        {error ? (
          <AppText align="center" style={{ color: c.danger, padding: spacing.md }}>
            {t(error.startsWith('napplets.') ? error : 'napplets.request_failed')}
          </AppText>
        ) : null}
        {!state.loaded || state.accountPubkey !== account ? (
          <ActivityIndicator color={c.accent} style={{ padding: spacing.lg }} />
        ) : desktop.length || recent.length ? (
          <NappletGrid onPermissions={(app) => navigation.open(`/napplet-permissions/${app.event.id}`)} onShare={share}
    onDetails={(app) => navigation.open(`/napplet/${app.event.id}`)}
            onRemoveRecent={(app) => { void nappletService.removeRecent(app.key, account ?? '').catch(() => setError('napplets.request_failed')); }}
            onShowRecent={() => navigation.open('/napplet-recent')} items={desktop} recent={recent} onOpen={open} onMove={action} bottomInset={bottomInset} onScrollChange={setScrolled} />
        ) : <Empty onAdd={() => router.push('/napplet-install')} />}
      </View>
    </AppScreen>
  );
}
function Empty({ onAdd }: { onAdd: () => void }) {
  const c = useThemeColors();
  const { t } = useTranslation();
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: spacing.xl,
        gap: spacing.lg,
      }}
    >
      <Widget size={spacing['3xl']} color={c.textMuted} />
      <AppText variant="title" align="center">
        {t('napplets.empty_title')}
      </AppText>
      <AppText tone="muted" align="center">
        {t('napplets.empty_description')}
      </AppText>
      <View><AppButton fullWidth={false} label={t('napplets.install_link')} onPress={onAdd} /></View>
    </View>
  );
}