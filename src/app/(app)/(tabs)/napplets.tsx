import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { router } from 'expo-router';
import { Widget } from '@solar-icons/react-native/category/settings/Linear/Widget';
import Plus from 'lucide-react-native/icons/plus';
import Refresh from 'lucide-react-native/icons/refresh-cw';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getBottomChromeInset } from '@/lib/layout/bottom-chrome';
import { AppScreen } from '@/components/common/AppScreen';
import { AppButton } from '@/components/common/AppButton';
import { AppCard } from '@/components/common/AppCard';
import { AppInput } from '@/components/common/AppInput';
import { AppText } from '@/components/common/AppText';
import { IconButton } from '@/components/common/IconButton';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { SegmentedControl } from '@/components/common/SegmentedControl';
import { NappletGrid } from '@/components/napplet/NappletGrid';
import { NappletIcon } from '@/components/napplet/NappletIcon';
import { nappletService } from '@/services/napplet/service';
import type { NappletRelease, NappletInstallation } from '@/services/napplet/protocol';
import { useNapplets } from '@/stores/napplet.store';
import { useActiveAccount } from '@/stores/active-account.store';
import { usePrimaryPaneNavigation } from '@/components/navigation/primary-pane-navigation';
import { bottomBarHeight, spacing, useThemeColors } from '@/theme';

export default function NappletsScreen() {
  const account = useActiveAccount((s) => s.activePubkey);
  return <AccountNapplets key={account ?? 'signed-out'} account={account} />;
}
function AccountNapplets({ account }: { account: string | null }) {
  const c = useThemeColors();
  const { t } = useTranslation();
  const state = useNapplets();
  const navigation = usePrimaryPaneNavigation();
  const [tab, setTab] = useState<'recent' | 'discovery'>('recent');
  const [error, setError] = useState<string | null>(null);
  const clearance = useScreenHeaderClearance();
  const bottomInset = bottomBarHeight + getBottomChromeInset(useSafeAreaInsets().bottom);
  useEffect(() => {
    if (account)
      void nappletService.activate(account).catch(() => setError('napplets.request_failed'));
  }, [account]);
  useEffect(() => {
    if (tab === 'discovery' && state.loaded && !state.market.length) void nappletService.discover();
  }, [tab, state.loaded, state.market.length]);
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
    (app: NappletInstallation, kind: 'pin' | 'unpin' | 'remove') => {
      void nappletService
        .recentAction(app.key, kind, account ?? '')
        .catch(() => setError('napplets.request_failed'));
    },
    [account],
  );
  return (
    <AppScreen edges={[]}>
      <ScreenHeader
        back={false}
        title={t('napplets.title')}
        right={
          <IconButton
            icon={<Plus size={spacing.xl} color={c.text} />}
            accessibilityLabel={t('napplets.install_link')}
            onPress={() => router.push('/napplet-install')}
          />
        }
      />
      <View style={{ flex: 1, paddingTop: clearance }}>
        <View style={{ padding: spacing.lg }}>
          <SegmentedControl
            value={tab}
            onChange={setTab}
            options={[
              { value: 'recent', label: t('napplets.recent') },
              { value: 'discovery', label: t('napplets.discovery') },
            ]}
          />
        </View>
        {error ? (
          <AppText align="center" style={{ color: c.danger, padding: spacing.md }}>
            {t(error.startsWith('napplets.') ? error : 'napplets.request_failed')}
          </AppText>
        ) : null}
        {!state.loaded || state.accountPubkey !== account ? (
          <ActivityIndicator color={c.accent} style={{ padding: spacing.lg }} />
        ) : tab === 'recent' ? (
          state.recent.length ? (
            <NappletGrid
              items={state.recent}
              onOpen={open}
              onAction={action}
              bottomInset={bottomInset}
            />
          ) : (
            <Empty onDiscovery={() => setTab('discovery')} />
          )
        ) : (
          <Discovery
            bottomInset={bottomInset}
            onDetail={(release) => navigation.open(`/napplet/${release.event.id}`)}
          />
        )}
      </View>
    </AppScreen>
  );
}
function Empty({ onDiscovery }: { onDiscovery: () => void }) {
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
      <AppButton fullWidth={false} label={t('napplets.discover')} onPress={onDiscovery} />
    </View>
  );
}
function Discovery({
  onDetail,
  bottomInset,
}: {
  onDetail: (release: NappletRelease) => void;
  bottomInset: number;
}) {
  const c = useThemeColors();
  const { t } = useTranslation();
  const { market, loading, hasMore, error } = useNapplets();
  const [search, setSearch] = useState('');
  const query = search.trim().toLocaleLowerCase();
  const items = query
    ? market.filter((app) => `${app.title}\n${app.description}`.toLocaleLowerCase().includes(query))
    : market;
  return (
    <>
      <View
        style={{
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.md,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
        }}
      >
        <View style={{ flex: 1 }}>
          <AppInput
            value={search}
            maxLength={256}
            onChangeText={setSearch}
            placeholder={t('napplets.search')}
            accessibilityLabel={t('napplets.search')}
          />
        </View>
        <IconButton
          icon={<Refresh size={spacing.xl} color={c.text} />}
          accessibilityLabel={t('napplets.refresh')}
          onPress={() => {
            void nappletService.discover(true);
          }}
          disabled={loading}
        />
      </View>
      {error ? (
        <AppText tone="muted" style={{ padding: spacing.lg }}>
          {t(error.startsWith('napplets.') ? error : 'napplets.request_failed')}
        </AppText>
      ) : null}
      <FlatList
        data={items}
        keyExtractor={(item) => item.key}
        initialNumToRender={12}
        contentContainerStyle={{
          padding: spacing.lg,
          gap: spacing.md,
          paddingBottom: bottomInset + spacing.xl,
        }}
        renderItem={({ item }) => (
          <AppCard>
            <View style={{ flexDirection: 'row', gap: spacing.lg }}>
              <NappletIcon release={item} />
              <View style={{ flex: 1, gap: spacing.sm }}>
                <AppText variant="subtitle" numberOfLines={1}>
                  {item.title}
                </AppText>
                <AppText tone="muted" numberOfLines={3}>
                  {item.description}
                </AppText>
                <AppButton
                  variant="accentText"
                  fullWidth={false}
                  label={t('napplets.details')}
                  onPress={() => onDetail(item)}
                />
              </View>
            </View>
          </AppCard>
        )}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={c.accent} />
          ) : (
            <AppText align="center" tone="muted">
              {t('napplets.no_results')}
            </AppText>
          )
        }
        ListFooterComponent={
          loading ? (
            <ActivityIndicator color={c.accent} />
          ) : hasMore ? (
            <AppButton
              variant="secondary"
              label={t('napplets.load_more')}
              onPress={() => {
                void nappletService.discover();
              }}
            />
          ) : null
        }
      />
    </>
  );
}
