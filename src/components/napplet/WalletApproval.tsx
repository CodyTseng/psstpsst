import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppInput } from '@/components/common/AppInput';
import { WalletPaymentConfirmSheet } from '@/components/wallet/WalletPaymentConfirmSheet';
import { nappletService } from '@/services/napplet/service';
import type { QueuedPrompt } from '@/services/napplet/prompt-queue';
import { spacing } from '@/theme';
import { satsFromMsat } from '@/lib/wallet/amount';
import { ApplicationIdentity } from './ApplicationIdentity';

type Props = { prompt: QueuedPrompt; visible: boolean; onClosed: () => void };

/** Business approval chooses a wallet; payment authentication belongs to the trusted platform. */
export function WalletApproval({ prompt, visible, onClosed }: Props) {
  const { t } = useTranslation();
  const wallet = prompt.wallet;
  const [selectedWalletId, setSelectedWalletId] = useState(() => wallet?.wallets.find(row => row.isDefault)?.id ?? wallet?.wallets[0]?.id ?? null);
  const [amount, setAmount] = useState(satsFromMsat(wallet?.amountMsat ?? 0));
  const closureReported = useRef(false);
  const finish = useCallback(() => { if (!closureReported.current) { closureReported.current = true; onClosed(); } }, [onClosed]);
  if (!wallet) return null;
  const numeric = Number(amount);
  const validAmount = !wallet.amountRange || /^\d+$/.test(amount) && Number.isSafeInteger(numeric) && numeric >= wallet.amountRange.min && numeric <= wallet.amountRange.max;
  function approve() {
    if (!visible || !selectedWalletId || !validAmount || Date.now() >= prompt.expiresAt) return;
    nappletService.answer(prompt.requestId, JSON.stringify({ walletId: selectedWalletId, ...(wallet?.amountRange ? { amountSats: numeric } : {}) }));
  }
  return <WalletPaymentConfirmSheet visible={visible} title={prompt.title}
    requester={<WalletRequester prompt={prompt} />} amount={`${wallet.amountRange ? amount : satsFromMsat(wallet.amountMsat)} ${t('wallet.sats_unit')}`}
    description={wallet.description} wallets={wallet.wallets} selectedWalletId={selectedWalletId} onSelectWallet={setSelectedWalletId}
    confirmLabel={t(wallet.operation === 'payment' ? 'wallet.pay' : 'wallet.create_invoice')} confirmDisabled={!validAmount}
    onConfirm={approve} onClose={() => nappletService.answer(prompt.requestId, false)} onClosed={finish} dismissOnBackdropPress={false}
    amountEditor={wallet.amountRange ? <AppInput label={t('wallet.amount_sats')} value={amount} keyboardType="number-pad" onChangeText={setAmount}
      description={t('wallet.amount_range', { min: wallet.amountRange.min, max: wallet.amountRange.max })} /> : undefined} />;
}

function WalletRequester({ prompt }: { prompt: QueuedPrompt }) {
  const requester = prompt.requester;
  if (!requester) return null;
  const application = prompt.application ?? prompt.app ?? { ...requester, servers: [] };
  return <ApplicationIdentity release={{ ...application, title: requester.title }} compact
    iconSize={spacing['2xl'] + spacing.sm} titleVariant="body" subtitle={requester.origin} />;
}
