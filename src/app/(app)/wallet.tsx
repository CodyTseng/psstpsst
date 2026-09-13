import { router, useFocusEffect, useNavigation } from 'expo-router';
import { Refresh as RefreshCw } from '@solar-icons/react-native/category/arrows/Linear/Refresh';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import { InfoCircle as Info } from '@solar-icons/react-native/category/ui/Linear/InfoCircle';
import { Wallet } from '@solar-icons/react-native/category/money/Linear/Wallet';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Easing, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppButton } from '@/components/common/AppButton';
import { AppCard } from '@/components/common/AppCard';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { IconButton } from '@/components/common/IconButton';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { WalletPickerSheet } from '@/components/wallet/WalletPickerSheet';
import { WalletTransactionRow } from '@/components/wallet/WalletTransactionRow';
import { useReceivingWallet } from '@/hooks/use-receiving-wallet';
import { useScrolled } from '@/hooks/use-scrolled';
import { useWallets, useWalletTransactions } from '@/hooks/use-wallets';
import { formatNumber } from '@/services/wallet/bolt11';
import { refreshWallet, type WalletError } from '@/services/wallet/wallet.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { useReceivingWalletPromptStore } from '@/stores/receiving-wallet-prompt.store';
import { useWalletPrefsStore } from '@/stores/wallet-prefs.store';
import { iconStrokeWidth } from '@/theme/icons';
import { spacing, uiDensity, useThemeColors } from '@/theme';

export default function WalletScreen() {
  const { t } = useTranslation();
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const topClearance = useScreenHeaderClearance();
  const accountPubkey = useActiveAccount((s) => s.activePubkey);
  const { scrolled, scrollProps } = useScrolled();
  const navigation = useNavigation();
  const { wallets, loaded: walletsLoaded } = useWallets(accountPubkey);
  const { receivingAddress, showReceivingWalletConfirmation } = useReceivingWallet(accountPubkey);
  const defaultWallet = wallets.find((w) => w.isDefault) ?? wallets[0] ?? null;
  const defaultWalletId = defaultWallet?.id ?? null;
  const defaultWalletRef = useRef(defaultWallet);
  const refreshTokenRef = useRef(0);
  const refreshingWalletIdRef = useRef<string | null>(null);
  const { transactions } = useWalletTransactions(defaultWallet?.id);
  const balanceVisible = useWalletPrefsStore((s) => s.isBalanceVisible(accountPubkey));
  const loadWalletPrefs = useWalletPrefsStore((s) => s.load);
  const setBalanceVisible = useWalletPrefsStore((s) => s.setBalanceVisible);
  const [balanceSnapshot, setBalanceSnapshot] = useState<{ walletId: string; balanceMsat: number | null } | null>(null);
  const [refreshingWalletId, setRefreshingWalletId] = useState<string | null>(null);
  const [errorSnapshot, setErrorSnapshot] = useState<{ walletId: string; message: string } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [refreshSpin] = useState(() => new Animated.Value(0));
  const refreshing = refreshingWalletId === defaultWalletId;

  useEffect(() => {
    if (!accountPubkey) return;
    void loadWalletPrefs(accountPubkey);
  }, [accountPubkey, loadWalletPrefs]);

  useEffect(() => {
    defaultWalletRef.current = defaultWallet;
  }, [defaultWallet]);

  useEffect(() => {
    if (!refreshing) {
      refreshSpin.stopAnimation();
      refreshSpin.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(refreshSpin, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: Platform.OS !== 'web',
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [refreshSpin, refreshing]);

  const refresh = useCallback(async () => {
    const wallet = defaultWalletRef.current;
    if (!wallet) return;
    const walletId = wallet.id;
    if (refreshingWalletIdRef.current === walletId) return;
    const refreshToken = ++refreshTokenRef.current;
    refreshingWalletIdRef.current = walletId;
    setRefreshingWalletId(walletId);
    setErrorSnapshot((current) => (current?.walletId === walletId ? null : current));
    try {
      const res = await refreshWallet(wallet);
      if (refreshTokenRef.current === refreshToken) {
        setBalanceSnapshot({ walletId, balanceMsat: res.balanceMsat });
      }
    } catch (err) {
      if (refreshTokenRef.current === refreshToken) {
        setErrorSnapshot({ walletId, message: walletErrorMessage(t, err as WalletError) });
      }
    } finally {
      if (refreshingWalletIdRef.current === walletId) {
        refreshingWalletIdRef.current = null;
        setRefreshingWalletId(null);
      }
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      if (!defaultWalletId) return;
      void refresh();
    }, [defaultWalletId, refresh]),
  );

  function openAddWallet() {
    setPickerOpen(false);
    router.push('/wallet-add');
  }

  useEffect(() => {
    if (!accountPubkey) return;
    return navigation.addListener(
      'transitionEnd' as never,
      (() => {
        const pending = useReceivingWalletPromptStore.getState().consume(accountPubkey);
        if (!pending) return;
        showReceivingWalletConfirmation(
          pending.walletId,
          pending.address,
          t('wallet.set_receiving_wallet_skip'),
        );
      }) as never,
    );
  }, [accountPubkey, navigation, showReceivingWalletConfirmation, t]);

  const walletName = defaultWallet ? defaultWallet.customName || defaultWallet.name : '';
  const displayedBalanceMsat =
    balanceSnapshot?.walletId === defaultWalletId ? balanceSnapshot.balanceMsat : defaultWallet?.balanceMsat ?? null;
  const error = errorSnapshot?.walletId === defaultWalletId ? errorSnapshot.message : null;
  const balanceLabel =
    balanceVisible && displayedBalanceMsat != null
      ? formatNumber(displayedBalanceMsat / 1000)
      : balanceVisible
        ? t('wallet.unknown')
        : t('wallet.balance_hidden');
  const showBalanceUnit = balanceVisible && displayedBalanceMsat != null;
  const refreshRotation = refreshSpin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <AppScreen edges={[]}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingTop: topClearance + spacing.sm,
          paddingBottom: Math.max(insets.bottom + spacing.lg, spacing['2xl']),
          gap: spacing.xl,
        }}
        {...scrollProps}
      >
        {!walletsLoaded ? null : defaultWallet ? (
          <>
            <View style={{ gap: spacing.xl }}>
              <View
                style={{
                  alignItems: 'center',
                  gap: spacing.md,
                  paddingTop: spacing.xl,
                  paddingBottom: spacing.sm,
                }}
              >
                <View style={{ alignSelf: 'stretch' }}>
                  <AppButton
                    label={balanceLabel}
                    variant="text"
                    fullWidth
                    compact
                    compactAxis="none"
                    labelVariant="amount"
                    contentAlign="baseline"
                    iconRight={
                      showBalanceUnit ? (
                        <AppText variant="caption" tone="muted" weight="semibold">
                          {t('wallet.sats_unit')}
                        </AppText>
                      ) : undefined
                    }
                    onPress={() => {
                      if (accountPubkey) setBalanceVisible(accountPubkey, !balanceVisible);
                    }}
                    accessibilityLabel={balanceVisible ? t('wallet.hide_balance') : t('wallet.show_balance')}
                  />
                </View>
                {error ? (
                  <AppText variant="caption" tone="warning" align="center">
                    {error}
                  </AppText>
                ) : null}
              </View>

              <View style={{ flexDirection: 'row', gap: spacing.md }}>
                <View style={{ flex: 1 }}>
                  <AppButton
                    label={t('wallet.receive')}
                    variant="secondary"
                    onPress={() => router.push('/wallet-receive')}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <AppButton
                    label={t('wallet.send')}
                    variant="secondary"
                    onPress={() => router.push('/wallet-send')}
                  />
                </View>
              </View>
            </View>

            <View style={{ gap: spacing.sm }}>
              <AppText variant="caption" tone="muted">
                {t('wallet.recent')}
              </AppText>
              {transactions.length > 0 ? (
                <View style={{ marginHorizontal: -spacing.lg }}>
                  {transactions.map((tx, index) => (
                    <WalletTransactionRow
                      key={tx.id}
                      transaction={tx}
                      showSeparator={index < transactions.length - 1}
                    />
                  ))}
                </View>
              ) : (
                <AppCard variant="plain">
                  <AppText variant="body" tone="muted" align="center">
                    {t('wallet.no_transactions')}
                  </AppText>
                </AppCard>
              )}
            </View>
          </>
        ) : (
          <View style={{ flex: 1, alignItems: 'center', gap: spacing.lg, paddingTop: spacing['3xl'] * 2 }}>
            <Wallet size={44} color={c.textMuted} />
            <View style={{ gap: spacing.sm }}>
              <AppText variant="title" weight="semibold" align="center">
                {t('wallet.empty_title')}
              </AppText>
              <AppText variant="body" tone="muted" align="center">
                {t('wallet.empty_hint')}
              </AppText>
            </View>
            <AppButton label={t('wallet.add')} variant="primary" onPress={openAddWallet} />
          </View>
        )}
      </ScrollView>

      {accountPubkey ? (
        <WalletPickerSheet
          visible={pickerOpen}
          accountPubkey={accountPubkey}
          wallets={wallets}
          receivingAddress={receivingAddress}
          onClose={() => setPickerOpen(false)}
          onAdd={openAddWallet}
        />
      ) : null}
      <ScreenHeader
        bordered={scrolled}
        title={defaultWallet ? undefined : t('wallet.title')}
        titleControl={
          defaultWallet ? (
            <AppButton
              label={walletName}
              labelVariant="subtitle"
              labelNumberOfLines={1}
              variant="text"
              corner="full"
              fullWidth={false}
              iconRight={<ChevronDown strokeWidth={iconStrokeWidth.default} size={16} color={c.text} />}
              onPress={() => setPickerOpen(true)}
            />
          ) : undefined
        }
        right={
          defaultWallet ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <IconButton
                variant="plain"
                size={uiDensity.headerActionSize}
                onPress={refresh}
                hitSlop={6}
                icon={
                  <Animated.View style={{ transform: [{ rotate: refreshRotation }] }}>
                    <RefreshCw size={uiDensity.headerActionIconSize} color={c.text} />
                  </Animated.View>
                }
                accessibilityLabel={t('wallet.refresh')}
              />
              <IconButton
                variant="plain"
                size={uiDensity.headerActionSize}
                icon={<Info size={uiDensity.headerActionIconSize} color={c.text} />}
                accessibilityLabel={t('wallet.details')}
                onPress={() => router.push({ pathname: '/wallet-detail/[id]', params: { id: defaultWallet.id } })}
              />
            </View>
          ) : undefined
        }
      />
    </AppScreen>
  );
}

function walletErrorMessage(t: (key: string) => string, err: WalletError): string {
  switch (err.kind) {
    case 'timeout':
      return t('wallet.wallet_timeout');
    case 'wallet_offline':
      return t('wallet.wallet_offline');
    case 'rate_limited':
      return t('wallet.rate_limited');
    case 'permission_denied':
      return t('wallet.permission_denied');
    case 'missing_secret':
      return t('wallet.connect_failed');
    default:
      return t('wallet.refresh_failed');
  }
}
