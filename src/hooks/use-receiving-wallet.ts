import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useProfile } from '@/hooks/use-profile';
import { platform } from '@/platform';
import { publishReceivingWalletAddress } from '@/services/wallet/receiving-wallet.service';
import { showToast } from '@/stores/toast.store';

export function useReceivingWallet(accountPubkey: string | null) {
  const { t } = useTranslation();
  const profile = useProfile(accountPubkey);
  const [settingReceivingWalletId, setSettingReceivingWalletId] = useState<string | null>(null);
  const [pendingReceivingProfile, setPendingReceivingProfile] = useState<{
    address: string;
    previousEventId: string | null;
  } | null>(null);

  const setAsReceivingWallet = useCallback(
    (walletId: string, address: string, previousEventId: string | null) => {
      if (!accountPubkey || settingReceivingWalletId) return;
      setSettingReceivingWalletId(walletId);

      // Let the loading state paint before SQLite reads and event signing run.
      setTimeout(() => {
        void (async () => {
          try {
            await publishReceivingWalletAddress(accountPubkey, address);
            setPendingReceivingProfile({ address, previousEventId });
            setSettingReceivingWalletId(null);
            showToast(t('wallet.receiving_wallet_set'));
          } catch {
            void platform.confirmationDialog.notify({ title: t('wallet.receiving_wallet_failed'), okLabel: t('common.ok') });
            setSettingReceivingWalletId(null);
          }
        })();
      }, 0);
    },
    [accountPubkey, settingReceivingWalletId, t],
  );

  const showReceivingWalletConfirmation = useCallback(
    (walletId: string, address: string, cancelLabel: string) => {
      void platform.confirmationDialog
        .confirm({
          title: t('wallet.set_receiving_wallet_title'),
          message: t('wallet.set_receiving_wallet_message', { address }),
          cancelLabel,
          confirmLabel: t('wallet.set_receiving_wallet_confirm'),
        })
        .then((confirmed) => {
          if (confirmed) {
            setAsReceivingWallet(walletId, address, profile?.rawEvent?.id ?? null);
          }
        });
    },
    [profile?.rawEvent?.id, setAsReceivingWallet, t],
  );

  const profileLightningAddress = profile?.lud16 || profile?.lud06 || '';
  const waitingForProfileUpdate =
    pendingReceivingProfile !== null &&
    pendingReceivingProfile.previousEventId === (profile?.rawEvent?.id ?? null);
  const receivingAddress = waitingForProfileUpdate
    ? pendingReceivingProfile.address
    : profileLightningAddress;

  return { receivingAddress, settingReceivingWalletId, showReceivingWalletConfirmation };
}
