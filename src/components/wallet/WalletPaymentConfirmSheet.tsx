import ChevronDown from 'lucide-react-native/icons/chevron-down';
import Check from 'lucide-react-native/icons/check';
import { Wallet } from '@solar-icons/react-native/category/money/Linear/Wallet';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ActionRow } from '@/components/common/ActionRow';
import { AppText } from '@/components/common/AppText';
import { BottomSheet } from '@/components/common/BottomSheet';
import { ListRow } from '@/components/common/ListRow';
import type { WalletRow } from '@/services/wallet/wallet.service';
import { iconStrokeWidth } from '@/theme/icons';
import { spacing, useThemeColors } from '@/theme';

import { WalletAmountDisplay } from './WalletAmountDisplay';

type Props = {
  visible: boolean;
  amount: string;
  description?: string | null;
  wallets: WalletRow[];
  selectedWalletId: string | null;
  onClose: () => void;
  onClosed?: () => void;
  onConfirm: () => void;
  onSelectWallet: (walletId: string) => void;
};

type WalletPickerPhase = 'idle' | 'opening' | 'open' | 'closing';

export function WalletPaymentConfirmSheet({
  visible,
  amount,
  description,
  wallets,
  selectedWalletId,
  onClose,
  onClosed,
  onConfirm,
  onSelectWallet,
}: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const [walletPickerPhase, setWalletPickerPhase] = useState<WalletPickerPhase>('idle');
  const selectedWallet = wallets.find((wallet) => wallet.id === selectedWalletId) ?? wallets[0] ?? null;
  const selectedWalletName = selectedWallet
    ? selectedWallet.customName || selectedWallet.name
    : t('wallet.none');
  const canSelectWallet = wallets.length > 1;

  function closeSheet() {
    onClose();
  }

  function confirmPayment() {
    onConfirm();
  }

  function openWalletPicker() {
    if (!canSelectWallet || walletPickerPhase !== 'idle') return;
    setWalletPickerPhase('opening');
  }

  function handleConfirmClosed() {
    if (walletPickerPhase === 'opening' && visible) {
      setTimeout(() => setWalletPickerPhase('open'), 0);
      return;
    }
    if (walletPickerPhase === 'opening') setWalletPickerPhase('idle');
    onClosed?.();
  }

  function closeWalletPicker() {
    if (walletPickerPhase === 'open') setWalletPickerPhase('closing');
  }

  function handleWalletPickerClosed() {
    setTimeout(() => {
      setWalletPickerPhase('idle');
      if (!visible) onClosed?.();
    }, 0);
  }

  return (
    <>
      <BottomSheet
        visible={visible && walletPickerPhase === 'idle'}
        onClose={closeSheet}
        onClosed={handleConfirmClosed}
        title={t('wallet.confirm_payment')}
        contentStyle={{ gap: spacing.xl }}
      >
        <WalletAmountDisplay amount={amount} />
        {description ? (
          <AppText variant="body" tone="muted" align="center" numberOfLines={2}>
            {description}
          </AppText>
        ) : null}
        <ListRow
          variant="plain"
          title={t('wallet.payment_method')}
          value={selectedWalletName}
          icon={<Wallet size={22} color={c.text} />}
          trailing={
            canSelectWallet ? (
              <ChevronDown strokeWidth={iconStrokeWidth.default} size={18} color={c.textMuted} />
            ) : null
          }
          onPress={canSelectWallet ? openWalletPicker : undefined}
        />
        <ActionRow
          layout="vertical"
          confirm={{ label: t('wallet.pay'), disabled: !selectedWallet, onPress: confirmPayment }}
        />
      </BottomSheet>

      {walletPickerPhase === 'open' || walletPickerPhase === 'closing' ? (
        <BottomSheet
          visible={walletPickerPhase === 'open'}
          onClose={closeWalletPicker}
          onClosed={handleWalletPickerClosed}
          title={t('wallet.select_wallet')}
          contentStyle={{ gap: spacing.xl }}
        >
          <View>
            {wallets.map((wallet) => {
              const selected = wallet.id === selectedWallet?.id;
              return (
                <ListRow
                  key={wallet.id}
                  variant="plain"
                  title={wallet.customName || wallet.name}
                  titleTone={selected ? 'accent' : 'default'}
                  trailing={
                    selected ? <Check strokeWidth={iconStrokeWidth.default} size={18} color={c.accent} /> : null
                  }
                  onPress={() => {
                    onSelectWallet(wallet.id);
                    closeWalletPicker();
                  }}
                />
              );
            })}
          </View>
        </BottomSheet>
      ) : null}
    </>
  );
}
