import { Backspace as Delete } from '@solar-icons/react-native/category/text-formatting/Linear/Backspace';
import { ChatSquare as MessageSquare } from '@solar-icons/react-native/category/messages/Linear/ChatSquare';
import { Share as Share2 } from '@solar-icons/react-native/category/ui/Linear/Share';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Share, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionRow } from '@/components/common/ActionRow';
import { AppButton } from '@/components/common/AppButton';
import { AppInput } from '@/components/common/AppInput';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { BottomSheet } from '@/components/common/BottomSheet';
import { IconButton } from '@/components/common/IconButton';
import { InputDialog } from '@/components/common/InputDialog';
import { QrCode } from '@/components/common/QrCode';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { WalletAmountDisplay } from '@/components/wallet/WalletAmountDisplay';
import { WalletReceiveMethodSelector } from '@/components/wallet/WalletReceiveMethodSelector';
import { WalletSuccessState } from '@/components/wallet/WalletSuccessState';
import { useAmountKeypadKeyboard } from '@/hooks/use-amount-keypad-keyboard';
import { useProfile } from '@/hooks/use-profile';
import { useWallets } from '@/hooks/use-wallets';
import { setStringAsync } from '@/lib/clipboard';
import { invoiceMessageTags } from '@/lib/wallet/invoice-message';
import type { ConversationDeliveryKind } from '@/lib/conversation/capabilities';
import { IS_ELECTRON } from '@/lib/platform';
import { platform } from '@/platform';
import { conversationSendService } from '@/services/conversation/conversation-send.service';
import { parseBolt11Invoice } from '@/services/wallet/bolt11';
import {
  LnurlError,
  requestLnurlPayInvoice,
  resolveLnurlPayTarget,
} from '@/services/wallet/lnurl';
import {
  cacheLocalInvoiceTransaction,
  lookupInvoiceStatus,
  makeInvoice,
  tryCacheLocalInvoiceTransaction,
  walletSupportsMethod,
  WalletError,
  type WalletRow,
} from '@/services/wallet/wallet.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { showToast } from '@/stores/toast.store';
import { radius, spacing, useThemeColors } from '@/theme';

type ReceiveSource =
  | { id: string; kind: 'wallet'; label: string; wallet: WalletRow }
  | { id: 'profile'; kind: 'profile'; label: string; address: string };

export default function WalletReceiveScreen() {
  const { t } = useTranslation();
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const titleClearance = useScreenHeaderClearance();
  const params = useLocalSearchParams<{
    conversationKey?: string | string[];
    sendTo?: string | string[];
    transport?: string | string[];
  }>();
  const chatRecipientPubkey = firstParam(params.sendTo);
  const chatConversationKey = firstParam(params.conversationKey);
  const chatDeliveryKind: ConversationDeliveryKind =
    firstParam(params.transport) === 'proximity' ? 'proximity' : 'relay';
  const sendToChat = !!chatRecipientPubkey && !!chatConversationKey;
  const accountPubkey = useActiveAccount((s) => s.activePubkey);
  const { wallets } = useWallets(accountPubkey);
  const profile = useProfile(accountPubkey);
  const defaultWallet = wallets.find((candidate) => candidate.isDefault) ?? wallets[0] ?? null;
  const profileLightningAddress = profile?.lud16 || profile?.lud06 || '';
  const receiveSources = useMemo<ReceiveSource[]>(() => {
    const walletSources: ReceiveSource[] = wallets
      .filter((candidate) => walletSupportsMethod(candidate, 'make_invoice'))
      .map((candidate) => ({
        id: `wallet:${candidate.id}`,
        kind: 'wallet',
        label: candidate.customName || candidate.name,
        wallet: candidate,
      }));
    if (profileLightningAddress) {
      walletSources.push({
        id: 'profile',
        kind: 'profile',
        label: profileLightningAddress,
        address: profileLightningAddress,
      });
    }
    return walletSources;
  }, [profileLightningAddress, wallets]);
  const [receiveSourceId, setReceiveSourceId] = useState<string | null>(null);
  const defaultReceiveSourceId = defaultWallet ? `wallet:${defaultWallet.id}` : null;
  const selectedReceiveSource =
    receiveSources.find((source) => source.id === receiveSourceId) ??
    receiveSources.find((source) => source.id === defaultReceiveSourceId) ??
    receiveSources[0] ??
    null;
  const wallet = sendToChat
    ? selectedReceiveSource?.kind === 'wallet'
      ? selectedReceiveSource.wallet
      : null
    : defaultWallet;
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [invoice, setInvoice] = useState('');
  const [paymentHash, setPaymentHash] = useState<string | null>(null);
  const [invoiceState, setInvoiceState] = useState<'waiting' | 'settled' | 'expired'>('waiting');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [amountSourceCenterY, setAmountSourceCenterY] = useState<number | null>(null);
  const descriptionInputRef = useRef<TextInput>(null);
  const recordAmountCenterY = useCallback((centerY: number) => {
    setAmountSourceCenterY((previous) => {
      if (previous != null && Math.abs(previous - centerY) <= 1) return previous;
      return centerY;
    });
  }, []);

  useEffect(() => {
    if (!wallet || !invoice || invoiceState !== 'waiting') return;
    let cancelled = false;
    function checkInvoice() {
      if (!wallet) return;
      lookupInvoiceStatus(wallet, { invoice, paymentHash })
        .then((state) => {
          if (cancelled) return;
          if (state === 'settled' || state === 'expired') {
            const parsedInvoice = parseBolt11Invoice(invoice);
            void tryCacheLocalInvoiceTransaction(wallet, {
              invoice: parsedInvoice.invoice,
              type: 'incoming',
              state,
              paymentHash: paymentHash ?? parsedInvoice.paymentHash,
              amountMsat: parsedInvoice.amountMsat,
              description,
              createdAt: parsedInvoice.createdAt,
              expiresAt: parsedInvoice.expiresAt,
            });
          }
          if (state === 'settled') setInvoiceState('settled');
          if (state === 'expired') setInvoiceState('expired');
        })
        .catch(() => {});
    }
    checkInvoice();
    const timer = setInterval(checkInvoice, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [description, invoice, invoiceState, paymentHash, wallet]);

  async function createInvoice() {
    if (loading) return;
    const source: ReceiveSource | null = sendToChat
      ? selectedReceiveSource
      : wallet
        ? {
            id: `wallet:${wallet.id}`,
            kind: 'wallet',
            label: wallet.customName || wallet.name,
            wallet,
          }
        : null;
    if (!source) return;
    const sats = Number(amount);
    if (!Number.isFinite(sats) || sats <= 0) {
      void platform.confirmationDialog.notify({ title: t('wallet.invalid_amount'), okLabel: t('common.ok') });
      return;
    }
    setLoading(true);
    try {
      let walletResult: Awaited<ReturnType<typeof makeInvoice>> | null = null;
      let parsedInvoice;
      if (source.kind === 'wallet') {
        if (!walletSupportsMethod(source.wallet, 'make_invoice')) {
          void platform.confirmationDialog.notify({ title: t('wallet.receive_not_supported'), okLabel: t('common.ok') });
          return;
        }
        walletResult = await makeInvoice(source.wallet, {
          amountMsat: Math.round(sats * 1000),
          description,
        });
        const nextInvoice = walletResult.invoice || walletResult.payment_request || '';
        if (!nextInvoice) throw new Error('missing invoice');
        parsedInvoice = parseBolt11Invoice(nextInvoice);
        await cacheLocalInvoiceTransaction(source.wallet, {
          invoice: parsedInvoice.invoice,
          type: 'incoming',
          state: isSettledInvoice(walletResult) ? 'settled' : 'pending',
          paymentHash: walletResult.payment_hash ?? parsedInvoice.paymentHash,
          preimage: walletResult.preimage ?? null,
          amountMsat: parsedInvoice.amountMsat,
          description,
          createdAt: parsedInvoice.createdAt,
          expiresAt: parsedInvoice.expiresAt,
          settledAt: walletResult.settled_at ?? null,
          raw: walletResult,
        });
      } else {
        const request = await resolveLnurlPayTarget(source.address);
        parsedInvoice = await requestLnurlPayInvoice(request, sats, description);
      }
      if (sendToChat && accountPubkey) {
        try {
          await conversationSendService.sendMessage({
            accountPubkey,
            target: {
              deliveryKind: chatDeliveryKind,
              conversationKey: chatRecipientPubkey,
            },
            content: parsedInvoice.invoice,
            extraTags: invoiceMessageTags(description),
          });
          showToast(t('wallet.invoice_sent'));
          router.back();
        } catch {
          void platform.confirmationDialog.notify({ title: t('wallet.invoice_send_failed'), okLabel: t('common.ok') });
        }
        return;
      }
      if (!walletResult) return;
      setInvoice(parsedInvoice.invoice);
      setPaymentHash(walletResult.payment_hash ?? parsedInvoice.paymentHash);
      setInvoiceState(isSettledInvoice(walletResult) ? 'settled' : 'waiting');
    } catch (err) {
      void platform.confirmationDialog.notify({ title: receiveErrorMessage(t, err), okLabel: t('common.ok') });
    } finally {
      setLoading(false);
    }
  }

  async function copyInvoice() {
    await setStringAsync(invoice);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const appendDigit = useCallback((digit: string) => {
    setAmount((prev) => {
      if (digit === '00' && (!prev || prev === '0')) return prev;
      if (prev === '0') return digit;
      const next = `${prev}${digit}`;
      return clampAmountInput(next);
    });
  }, []);

  const deleteDigit = useCallback(() => {
    setAmount((prev) => prev.slice(0, -1));
  }, []);

  useAmountKeypadKeyboard({
    enabled: !invoice && !loading && !descriptionOpen,
    onDigit: appendDigit,
    onDelete: deleteDigit,
  });

  function openDescription() {
    setDraftDescription(description);
    setDescriptionOpen(true);
  }

  function saveDescription() {
    setDescription(draftDescription.trim());
    setDescriptionOpen(false);
  }

  const keypad = (
    <View style={{ alignSelf: 'stretch', gap: spacing.sm }}>
      <KeypadRow digits={['1', '2', '3']} onPress={appendDigit} />
      <KeypadRow digits={['4', '5', '6']} onPress={appendDigit} />
      <KeypadRow digits={['7', '8', '9']} onPress={appendDigit} />
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <KeypadDigit digit="00" onPress={appendDigit} />
        <KeypadDigit digit="0" onPress={appendDigit} />
        <View style={{ flex: 1 }}>
          <AppButton
            variant="secondary"
            size="xl"
            disabled={!amount}
            onPress={deleteDigit}
            iconLeft={<Delete size={22} color={c.text} />}
            accessibilityLabel={t('wallet.delete_digit')}
          />
        </View>
      </View>
    </View>
  );

  return (
    <AppScreen edges={[]}>
      {!invoice ? (
        <View
          style={{
            flex: 1,
            padding: spacing.lg,
            paddingTop: titleClearance + spacing.lg,
            paddingBottom: Math.max(insets.bottom + spacing.lg, spacing['2xl']),
          }}
        >
          <View
            style={{
              flex: 1,
              justifyContent: 'center',
              alignItems: 'center',
              gap: sendToChat ? spacing.xl : spacing.lg,
            }}
          >
            <View style={{ alignSelf: 'stretch', alignItems: 'center', gap: spacing.md }}>
              <WalletAmountDisplay
                amount={amount ? Number(amount).toLocaleString() : '0'}
                unit={t('wallet.sats_unit')}
                onCenterYChange={recordAmountCenterY}
              />
              <View style={{ alignSelf: 'stretch', flexDirection: 'row', justifyContent: 'center' }}>
                <AppButton
                  label={description || t('wallet.add_description')}
                  variant="secondary"
                  fullWidth={false}
                  corner="full"
                  iconLeft={<MessageSquare size={18} color={c.text} />}
                  onPress={openDescription}
                />
              </View>
            </View>
            {sendToChat && selectedReceiveSource ? (
              <View style={{ alignSelf: 'stretch' }}>
                <WalletReceiveMethodSelector
                  options={receiveSources}
                  selectedId={selectedReceiveSource.id}
                  onSelect={setReceiveSourceId}
                />
              </View>
            ) : null}
            {sendToChat ? keypad : null}
          </View>

          <View style={{ gap: spacing.lg }}>
            {!sendToChat ? keypad : null}
            <AppButton
              label={t('wallet.create_invoice')}
              variant="primary"
              size="lg"
              disabled={!amount || (sendToChat ? !selectedReceiveSource : !wallet)}
              loading={loading}
              onPress={createInvoice}
            />
          </View>
        </View>
      ) : invoiceState === 'settled' ? (
        <View
          style={{
            flex: 1,
            padding: spacing.lg,
            paddingTop: titleClearance + spacing.lg,
            paddingBottom: Math.max(insets.bottom + spacing.lg, spacing['2xl']),
          }}
        >
          <WalletSuccessState
            title={t('wallet.received_payment')}
            amount={Number(amount).toLocaleString()}
            amountUnit={t('wallet.sats_unit')}
            amountSourceCenterY={amountSourceCenterY}
            description={description}
            actionLabel={t('common.done')}
            onAction={() => router.back()}
          />
        </View>
      ) : (
        <View
          style={{
            flex: 1,
            padding: spacing.lg,
            paddingTop: titleClearance + spacing.lg,
            paddingBottom: Math.max(insets.bottom + spacing.lg, spacing['2xl']),
            justifyContent: 'space-between',
            gap: spacing.lg,
          }}
        >
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.lg }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <ActivityIndicator color={c.textMuted} />
              <AppText variant="caption" tone="muted" align="center">
                {invoiceState === 'expired' ? t('wallet.expired') : t('wallet.waiting_payment')}
              </AppText>
            </View>

            <View style={{ padding: spacing.lg, backgroundColor: c.onOverlay, borderRadius: radius.lg }}>
              <QrCode data={`lightning:${invoice}`} size={240} />
            </View>

            <View style={{ alignItems: 'center', gap: spacing.sm }}>
              <WalletAmountDisplay
                amount={Number(amount).toLocaleString()}
                unit={t('wallet.sats_unit')}
                onCenterYChange={recordAmountCenterY}
              />
              {description ? (
                <AppText variant="body" align="center" numberOfLines={2}>
                  {description}
                </AppText>
              ) : null}
            </View>
          </View>

          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <View style={{ flex: 1 }}>
              <AppButton
                label={copied ? t('wallet.copied') : t('profile.qr_copy')}
                variant="secondary"
                onPress={copyInvoice}
              />
            </View>
            <IconButton
              variant="secondary"
              shape="square"
              size={46}
              onPress={() => void Share.share({ message: invoice })}
              icon={<Share2 size={18} color={c.text} />}
              accessibilityLabel={t('profile.qr_share')}
            />
          </View>
        </View>
      )}

      <ScreenHeader title={t('wallet.receive')} />

      {IS_ELECTRON ? (
        // A pure value entry — the desktop form is the centered input dialog
        // (DESIGN §10 Electron presentation split).
        <InputDialog
          visible={descriptionOpen}
          onClose={() => setDescriptionOpen(false)}
          actionLayout="horizontal"
          cancelLabel={t('common.cancel')}
          confirmLabel={t('common.done')}
          onConfirm={saveDescription}
        >
          <AppInput
            value={draftDescription}
            onChangeText={setDraftDescription}
            placeholder={t('wallet.description_placeholder')}
            multiline
            autoFocus
          />
        </InputDialog>
      ) : (
        <BottomSheet
          visible={descriptionOpen}
          onClose={() => setDescriptionOpen(false)}
          inputFocusRef={descriptionInputRef}
          title={t('wallet.description')}
          contentStyle={{ gap: spacing.lg }}
        >
          <AppInput
            ref={descriptionInputRef}
            value={draftDescription}
            onChangeText={setDraftDescription}
            placeholder={t('wallet.description_placeholder')}
            multiline
          />
          <ActionRow
            layout="horizontal"
            dismiss={{ label: t('common.cancel'), onPress: () => setDescriptionOpen(false) }}
            confirm={{ label: t('common.done'), onPress: saveDescription }}
          />
        </BottomSheet>
      )}
    </AppScreen>
  );
}

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function KeypadRow({ digits, onPress }: { digits: string[]; onPress: (digit: string) => void }) {
  return (
    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
      {digits.map((digit) => (
        <KeypadDigit key={digit} digit={digit} onPress={onPress} />
      ))}
    </View>
  );
}

function KeypadDigit({ digit, onPress }: { digit: string; onPress: (digit: string) => void }) {
  return (
    <View style={{ flex: 1 }}>
      <AppButton
        label={digit}
        labelVariant="title"
        variant="secondary"
        size="xl"
        onPress={() => onPress(digit)}
      />
    </View>
  );
}

function receiveErrorMessage(t: (key: string) => string, err: unknown): string {
  if (err instanceof LnurlError) {
    switch (err.kind) {
      case 'invalid_amount':
        return t('wallet.invalid_amount');
      case 'invalid_target':
        return t('wallet.invalid_payment_target');
      case 'network':
        return t('wallet.payment_target_unreachable');
      case 'unsupported':
        return t('wallet.payment_target_unsupported');
      default:
        return t('wallet.invoice_failed');
    }
  }
  if (!(err instanceof WalletError)) return t('wallet.invoice_failed');
  switch (err.kind) {
    case 'not_supported':
      return t('wallet.receive_not_supported');
    case 'permission_denied':
      return t('wallet.receive_permission_denied');
    case 'timeout':
      return t('wallet.wallet_timeout');
    case 'wallet_offline':
      return t('wallet.wallet_offline');
    case 'rate_limited':
      return t('wallet.rate_limited');
    default:
      return t('wallet.invoice_failed');
  }
}

const MAX_AMOUNT_SATS = 1_000_000_000;

function clampAmountInput(input: string): string {
  const digits = input.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  if (!digits) return '';
  const value = Number(digits);
  if (!Number.isFinite(value)) return String(MAX_AMOUNT_SATS);
  return String(Math.min(value, MAX_AMOUNT_SATS));
}

function isSettledInvoice(res: { state?: string; settled_at?: number; preimage?: string }): boolean {
  return res.state === 'settled' || Boolean(res.settled_at || res.preimage);
}
