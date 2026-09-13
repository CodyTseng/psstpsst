import { useLocalSearchParams } from 'expo-router';
import Check from 'lucide-react-native/icons/check';
import { Wallet } from '@solar-icons/react-native/category/money/Linear/Wallet';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { ListGroup } from '@/components/common/ListGroup';
import { ListRow } from '@/components/common/ListRow';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { WalletNameRow } from '@/components/wallet/WalletNameRow';
import { useReceivingWallet } from '@/hooks/use-receiving-wallet';
import { useScrolled } from '@/hooks/use-scrolled';
import { useWallets } from '@/hooks/use-wallets';
import { useActiveAccount } from '@/stores/active-account.store';
import { iconStrokeWidth } from '@/theme/icons';
import { spacing, uiDensity, useThemeColors } from '@/theme';

export default function WalletDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const c = useThemeColors();
  const topClearance = useScreenHeaderClearance();
  const { scrolled, scrollProps } = useScrolled();
  const accountPubkey = useActiveAccount((s) => s.activePubkey);
  const { wallets, loaded } = useWallets(accountPubkey);
  const wallet = wallets.find((item) => item.id === id && item.accountPubkey === accountPubkey);
  const { receivingAddress, settingReceivingWalletId, showReceivingWalletConfirmation } =
    useReceivingWallet(accountPubkey);
  const isReceivingWallet = Boolean(wallet?.lud16) && wallet?.lud16 === receivingAddress;

  return (
    <AppScreen edges={['bottom']}>
      <ScrollView
        {...scrollProps}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingTop: topClearance + spacing.sm,
          paddingBottom: spacing.xl,
          gap: spacing.xl,
        }}
      >
        {!loaded ? null : wallet ? (
          <>
            <WalletNameRow key={wallet.id} wallet={wallet} />
            <ListGroup>
              <ListRow
                title={t('profile.lightning_address')}
                value={wallet.lud16 || t('wallet.none')}
                valuePlacement="below"
                valueMultiline
              />
              {wallet.lud16 ? (
                isReceivingWallet ? (
                  <ListRow
                    title={t('wallet.receiving_wallet')}
                    trailing={<Check strokeWidth={iconStrokeWidth.default} size={uiDensity.headerActionIconSize} color={c.success} />}
                  />
                ) : (
                  <ListRow
                    title={t('wallet.set_receiving_wallet')}
                    loading={settingReceivingWalletId === wallet.id}
                    disabled={settingReceivingWalletId !== null}
                    onPress={() => showReceivingWalletConfirmation(wallet.id, wallet.lud16!, t('common.cancel'))}
                  />
                )
              ) : null}
            </ListGroup>
          </>
        ) : (
          <View style={{ alignItems: 'center', gap: spacing.lg, paddingTop: spacing.xl }}>
            <Wallet size={uiDensity.headerActionSize} color={c.textMuted} />
            <AppText variant="title" align="center">{t('wallet.missing')}</AppText>
          </View>
        )}
      </ScrollView>
      <ScreenHeader bordered={scrolled} title={t('wallet.details')} />
    </AppScreen>
  );
}
