import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppText } from '@/components/common/AppText';
import { AppInput } from '@/components/common/AppInput';
import { ActionRow } from '@/components/common/ActionRow';
import { BottomSheet } from '@/components/common/BottomSheet';
import { WalletPaymentConfirmSheet } from '@/components/wallet/WalletPaymentConfirmSheet';
import { WalletPinSheet } from '@/components/wallet/WalletPinSheet';
import { authorizeWalletPin, consumeWalletPinAuthorization } from '@/services/wallet/wallet-pin.service';
import { nappletService } from '@/services/napplet/service';
import type { QueuedPrompt } from '@/services/napplet/prompt-queue';
import type { WalletApprovalRequest, WalletDecision } from '@/lib/wallet/approval';
import { contentWidth, spacing } from '@/theme';
import { satsFromMsat } from '@/lib/wallet/amount';
import { SigningAccountAvatar } from './SigningRequestDetails';

type Props = { prompt: QueuedPrompt; visible: boolean; onClosed: () => void };
type Review = Exclude<WalletApprovalRequest, { operation: 'connect' }>;

export function WalletApproval(props: Props) {
  const { t } = useTranslation();
  const { prompt, visible, onClosed } = props;
  const request = prompt.wallet;
  if (!request) return null;
  if (request.operation !== 'connect') return <WalletPaymentApproval {...props} wallet={request} />;
  return <BottomSheet visible={visible} onClose={() => nappletService.answer(prompt.requestId, false)} onClosed={onClosed}
    title={prompt.title} headerAction={<SigningAccountAvatar pubkey={prompt.accountPubkey!} />} maxWidth={contentWidth.focused}
    dismissOnBackdropPress={false} contentStyle={{ gap: spacing.xl }}>
    <WalletRequester prompt={prompt} />
    <AppText variant="body" tone="muted">{prompt.detail}</AppText>
    <ActionRow layout="vertical" confirm={{ label: t('napplets.allow'), onPress: () => nappletService.answer(prompt.requestId, 'allow') }} />
  </BottomSheet>;
}

/** The existing confirmation, picker and PIN sheets retain their serialized lifecycle. */
function WalletPaymentApproval({ prompt, wallet, visible, onClosed }: Props & { wallet: Review }) {
  const { t } = useTranslation();
  const [selectedWalletId, setSelectedWalletId] = useState(() =>
    wallet.wallets.find(row => row.isDefault)?.id ?? wallet.wallets[0]?.id ?? null);
  const [amount, setAmount] = useState(satsFromMsat(wallet.amountMsat));
  const [phase, setPhase] = useState<'confirm' | 'pin-opening' | 'pin'>('confirm');
  const approvedWallet = useRef<string | null>(null);
  const pinApproved = useRef(false);
  const pinPresented = useRef(false);
  const confirmClosed = useRef(false);
  const closureReported = useRef(false);
  const active = useRef(visible);
  useLayoutEffect(() => { active.current = visible; }, [visible]);
  const finish = useCallback(() => {
    if (closureReported.current) return;
    closureReported.current = true;
    onClosed();
  }, [onClosed]);
  useEffect(() => {
    if (phase !== 'pin') return;
    if (visible) pinPresented.current = true;
    // Cancellation can win the commit between confirmation dismissal and PIN presentation.
    else if (!pinPresented.current && confirmClosed.current) finish();
  }, [visible, phase, finish]);
  const numeric = Number(amount);
  const validAmount = !wallet.amountRange || /^\d+$/.test(amount) && Number.isSafeInteger(numeric)
    && numeric >= wallet.amountRange.min && numeric <= wallet.amountRange.max;
  function reject() { nappletService.answer(prompt.requestId, false); }
  function answer(decision: WalletDecision) { nappletService.answer(prompt.requestId, JSON.stringify(decision)); }
  function approve() {
    if (!visible || !selectedWalletId || !validAmount || Date.now() >= prompt.expiresAt) return;
    approvedWallet.current = selectedWalletId;
    if (wallet.authentication === 'pin') { setPhase('pin-opening'); return; }
    answer({ walletId: selectedWalletId, ...(wallet.amountRange ? { amountSats: numeric } : {}) });
  }
  async function submitPin(pin: string) {
    if (!active.current || !approvedWallet.current || Date.now() >= prompt.expiresAt) return false;
    const token = await authorizeWalletPin(prompt.accountPubkey!, pin);
    if (!token) return false;
    if (!active.current || Date.now() >= prompt.expiresAt) {
      consumeWalletPinAuthorization(prompt.accountPubkey!, token);
      return false;
    }
    pinApproved.current = true;
    answer({ walletId: approvedWallet.current, pinAuthorization: token });
    return true;
  }
  return <>
    <WalletPaymentConfirmSheet visible={visible && phase === 'confirm'}
      title={prompt.title} headerAction={<SigningAccountAvatar pubkey={prompt.accountPubkey!} />}
      requester={<WalletRequester prompt={prompt} />}
      amount={`${wallet.amountRange ? amount : satsFromMsat(wallet.amountMsat)} ${t('wallet.sats_unit')}`}
      description={wallet.description} wallets={wallet.wallets}
      selectedWalletId={selectedWalletId} onSelectWallet={setSelectedWalletId}
      confirmLabel={wallet.operation === 'payment' ? t('wallet.pay') : t('wallet.create_invoice')}
      confirmDisabled={!validAmount} onConfirm={approve} onClose={reject}
      onClosed={() => {
        confirmClosed.current = true;
        if (phase === 'pin-opening' && visible) setPhase('pin');
        else finish();
      }} dismissOnBackdropPress={false}
      amountEditor={wallet.amountRange ? <AppInput label={t('wallet.amount_sats')} value={amount}
        keyboardType="number-pad" onChangeText={setAmount}
        description={t('wallet.amount_range', { min: wallet.amountRange.min, max: wallet.amountRange.max })} /> : undefined} />
    {phase === 'pin' ? <WalletPinSheet visible={visible} mode="verify" onSubmit={submitPin}
      onClose={() => { if (!pinApproved.current) reject(); }} onClosed={finish} /> : null}
  </>;
}

function WalletRequester({ prompt }: { prompt: QueuedPrompt }) {
  return prompt.requester ? <View style={{ gap: spacing.xs }}>
    <AppText variant="subtitle">{prompt.requester.title}</AppText>
    <AppText variant="caption" tone="muted">{prompt.requester.origin}</AppText>
  </View> : null;
}
