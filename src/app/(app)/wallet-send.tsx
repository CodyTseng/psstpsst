import { CameraView, scanFromURLAsync, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { Clipboard as ClipboardPaste } from '@solar-icons/react-native/category/notes/Linear/Clipboard';
import { Backspace as Delete } from '@solar-icons/react-native/category/text-formatting/Linear/Backspace';
import { Gallery as Image } from '@solar-icons/react-native/category/video/Linear/Gallery';
import { Keyboard } from '@solar-icons/react-native/category/devices/Linear/Keyboard';
import { ChatSquare as MessageSquare } from '@solar-icons/react-native/category/messages/Linear/ChatSquare';
import { Scanner } from '@solar-icons/react-native/category/security/Linear/Scanner';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionRow } from '@/components/common/ActionRow';
import { AppButton } from '@/components/common/AppButton';
import { AppInput } from '@/components/common/AppInput';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { BottomSheet } from '@/components/common/BottomSheet';
import { RoundOverlayAction } from '@/components/common/RoundOverlayAction';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { ScannerCloseButton } from '@/components/common/scanner-close-button';
import { ExternalInvoicePayment } from '@/components/wallet/external-invoice-payment';
import { WalletAmountDisplay } from '@/components/wallet/WalletAmountDisplay';
import { WalletPaymentConfirmSheet } from '@/components/wallet/WalletPaymentConfirmSheet';
import { WalletPaymentStatus, type WalletPaymentStatusValue } from '@/components/wallet/WalletPaymentStatus';
import { WalletPinSheet } from '@/components/wallet/WalletPinSheet';
import { useScrolled } from '@/hooks/use-scrolled';
import { useWallets } from '@/hooks/use-wallets';
import { getStringAsync } from '@/lib/clipboard';
import { routeStringParam, type RouteParam } from '@/lib/navigation/route-params';
import { resolveName } from '@/lib/nostr/display-name';
import { abbreviateNpub } from '@/lib/nostr/format';
import { parseNostrProfileInput, pubkeyToNpub, type ParsedNostrProfileInput } from '@/lib/nostr/keys';
import { isNip05Identifier, queryNip05Profile } from '@/lib/nostr/nip05';
import { platform } from '@/platform';
import { formatSats, parseBolt11Invoice, type ParsedInvoice } from '@/services/wallet/bolt11';
import { fetchProfile, getProfile } from '@/services/profile/profile.service';
import {
  isLikelyLnurlPayTarget,
  LnurlError,
  type LnurlPayRequest,
  normalizeLightningInput,
  requestLnurlPayInvoice,
  resolveLnurlPayTarget,
} from '@/services/wallet/lnurl';
import { payInvoice, WalletError, type WalletRow } from '@/services/wallet/wallet.service';
import {
  authorizeWalletPin,
  setWalletPin,
  walletAuthenticationMode,
} from '@/services/wallet/wallet-pin.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { spacing, useThemeColors } from '@/theme';

type SendStep = 'scan' | 'manual' | 'amount' | 'review' | 'payment';
type PaymentIntent = 'invoice' | 'lnurl';

class ProfilePaymentError extends Error {
  constructor(
    readonly kind: 'no_lightning_address' | 'profile_unreachable',
    readonly name: string,
  ) {
    super(kind);
  }
}

export default function WalletSendScreen() {
  const { t } = useTranslation();
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const titleClearance = useScreenHeaderClearance();
  const params = useLocalSearchParams<{ input?: string | string[] }>();
  const initialInput = firstParam(params.input, 8_192);
  const accountPubkey = useActiveAccount((s) => s.activePubkey);
  const { wallets, loaded: walletsLoaded } = useWallets(accountPubkey);
  const wallet = wallets.find((candidate) => candidate.isDefault) ?? wallets[0] ?? null;
  const [paymentInput, setPaymentInput] = useState(initialInput);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [paymentConfirmOpen, setPaymentConfirmOpen] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<WalletPaymentStatusValue>('processing');
  const [paymentWalletId, setPaymentWalletId] = useState<string | null>(null);
  const [lnurlRequest, setLnurlRequest] = useState<LnurlPayRequest | null>(null);
  const [reviewInvoice, setReviewInvoice] = useState<ParsedInvoice | null>(null);
  const [step, setStep] = useState<SendStep>(initialInput ? 'manual' : 'scan');
  const { scrolled, scrollProps } = useScrolled({ resetKey: step });
  const [resolving, setResolving] = useState(false);
  const [paying, setPaying] = useState(false);
  const [paymentPinOpen, setPaymentPinOpen] = useState(false);
  const [paymentPinMode, setPaymentPinMode] = useState<'verify' | 'setup'>('verify');
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [permission, requestPermission] = useCameraPermissions();
  const handledScanRef = useRef(false);
  const acceptedInitialInputRef = useRef<string | null>(null);
  const descriptionInputRef = useRef<TextInput>(null);
  const paymentIntentRef = useRef<PaymentIntent | null>(null);
  const paymentConfirmedRef = useRef(false);
  const paymentWalletRef = useRef<WalletRow | null>(null);
  const paymentPinAuthorizationRef = useRef<string | null>(null);
  const paymentPinApprovedRef = useRef(false);
  const preparingExternalInvoiceRef = useRef(false);

  useEffect(() => {
    if (step !== 'review') return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [step]);

  let manualInvoice: ParsedInvoice | null = null;
  try {
    manualInvoice = paymentInput.trim() ? parseInvoiceInput(paymentInput) : null;
  } catch {}
  const manualInputValid =
    paymentInput.trim().length > 0 &&
    (manualInvoice != null || isLikelyLnurlPayTarget(paymentInput) || isLikelyProfilePaymentTarget(paymentInput));
  const amountSats = parseSatsAmount(amount);
  const amountValid =
    lnurlRequest != null &&
    amountSats != null &&
    amountSats * 1000 >= lnurlRequest.minSendableMsat &&
    amountSats * 1000 <= lnurlRequest.maxSendableMsat;

  const acceptPaymentInput = useCallback(
    async (data: string, backStep: SendStep, alertInvalid: boolean) => {
      const nextInput = extractPaymentInput(data);
      try {
        const parsed = parseBolt11Invoice(nextInput);
        setPaymentInput(nextInput);
        setReviewInvoice(parsed);
        setLnurlRequest(null);
        setStep('review');
        return;
      } catch {}

      let targetInput = nextInput;
      const profileTarget = parseProfilePaymentTarget(nextInput);
      if (profileTarget) {
        try {
          targetInput = await resolveProfilePaymentTarget(profileTarget);
        } catch (err) {
          handledScanRef.current = false;
          if (backStep === 'manual') {
            setPaymentInput(nextInput);
            setStep('manual');
          }
          if (alertInvalid) showProfilePaymentError(t, err);
          return;
        }
      }

      if (!isLikelyLnurlPayTarget(targetInput)) {
        handledScanRef.current = false;
        if (alertInvalid) {
          if (backStep === 'manual') {
            setPaymentInput(nextInput);
            setStep('manual');
          }
          void platform.confirmationDialog.notify({ title: t('wallet.invalid_invoice'), okLabel: t('common.ok') });
        }
        return;
      }

      setResolving(true);
      try {
        const request = await resolvePaymentAddress(targetInput);
        setPaymentInput(nextInput);
        setLnurlRequest(request);
        setReviewInvoice(null);
        setAmount(defaultAmountFor(request));
        setDescription('');
        setDraftDescription('');
        setStep('amount');
      } catch (err) {
        handledScanRef.current = false;
        if (backStep === 'manual') {
          setPaymentInput(nextInput);
          setStep('manual');
        }
        if (alertInvalid) {
          if (err instanceof ProfilePaymentError) {
            showProfilePaymentError(t, err);
          } else {
            void platform.confirmationDialog.notify({ title: lnurlErrorMessage(t, err), okLabel: t('common.ok') });
          }
        }
      } finally {
        setResolving(false);
      }
    },
    [t],
  );

  useEffect(() => {
    if (!initialInput || acceptedInitialInputRef.current === initialInput) return;
    acceptedInitialInputRef.current = initialInput;
    const timer = setTimeout(() => {
      handledScanRef.current = true;
      void acceptPaymentInput(initialInput, 'manual', true);
    }, 0);
    return () => clearTimeout(timer);
  }, [acceptPaymentInput, initialInput]);

  function openPaymentConfirmation(intent: PaymentIntent) {
    const paymentWallet =
      wallets.find((candidate) => candidate.id === paymentWalletId) ?? wallet;
    if (!paymentWallet || paying) return;
    paymentIntentRef.current = intent;
    paymentWalletRef.current = paymentWallet;
    setPaymentWalletId(paymentWallet.id);
    setPaymentConfirmOpen(true);
  }

  function selectPaymentWallet(walletId: string) {
    const paymentWallet = wallets.find((candidate) => candidate.id === walletId);
    if (!paymentWallet) return;
    paymentWalletRef.current = paymentWallet;
    setPaymentWalletId(paymentWallet.id);
  }

  function confirmPayment() {
    if (!paymentIntentRef.current || !paymentWalletRef.current || paying) return;
    paymentConfirmedRef.current = true;
    setPaying(true);
    setPaymentConfirmOpen(false);
  }

  function handlePaymentConfirmClosed() {
    if (!paymentConfirmedRef.current) return;
    paymentConfirmedRef.current = false;
    const intent = paymentIntentRef.current;
    if (!intent) return;
    setTimeout(() => void beginPaymentAuthentication(intent), 0);
  }

  async function beginPaymentAuthentication(intent: PaymentIntent) {
    if (!accountPubkey) {
      setPaying(false);
      return;
    }
    try {
      const mode = await walletAuthenticationMode(accountPubkey);
      if (mode === 'system') {
        startPayment(intent);
        return;
      }
      setPaymentPinMode(mode === 'pin' ? 'verify' : 'setup');
      setPaymentPinOpen(true);
    } catch {
      setPaying(false);
      void platform.confirmationDialog.notify({ title: t('wallet.auth_failed'), okLabel: t('common.ok') });
    }
  }

  function startPayment(intent: PaymentIntent) {
    setPaymentStatus('processing');
    setStep('payment');
    setTimeout(() => void executePayment(intent, paymentPinAuthorizationRef.current), 0);
  }

  async function submitPaymentPin(pin: string): Promise<boolean> {
    if (!accountPubkey) return false;
    if (paymentPinMode === 'setup') await setWalletPin(accountPubkey, pin);
    const authorization = await authorizeWalletPin(accountPubkey, pin);
    if (!authorization) return false;
    paymentPinAuthorizationRef.current = authorization;
    paymentPinApprovedRef.current = true;
    return true;
  }

  function closePaymentPin() {
    setPaymentPinOpen(false);
    if (!paymentPinApprovedRef.current) setPaying(false);
  }

  function handlePaymentPinClosed() {
    if (!paymentPinApprovedRef.current) return;
    paymentPinApprovedRef.current = false;
    const intent = paymentIntentRef.current;
    if (intent) startPayment(intent);
  }

  async function executePayment(intent: PaymentIntent, pinAuthorization: string | null) {
    const fallbackStep: SendStep = intent === 'lnurl' ? 'amount' : 'review';
    const paymentWallet = paymentWalletRef.current;
    if (!paymentWallet) {
      setPaying(false);
      setStep(fallbackStep);
      return;
    }

    try {
      let invoice = reviewInvoice;
      let metadata: Record<string, unknown> | undefined;
      if (intent === 'lnurl') {
        if (!lnurlRequest || !amountSats) {
          setStep(fallbackStep);
          return;
        }
        invoice = await requestLnurlPayInvoice(lnurlRequest, amountSats, description);
        setReviewInvoice(invoice);
        metadata = paymentMetadata(description, lnurlRequest.target);
      }
      if (!invoice) {
        setStep(fallbackStep);
        return;
      }
      await payInvoice(
        paymentWallet,
        invoice.invoice,
        {
          prompt: t('wallet.auth_prompt'),
          cancel: t('common.cancel'),
        },
        metadata,
        pinAuthorization ?? undefined,
      );
      paymentPinAuthorizationRef.current = null;
      setPaymentStatus('success');
    } catch (err) {
      if (err instanceof LnurlError) {
        setStep(fallbackStep);
        void platform.confirmationDialog.notify({ title: lnurlErrorMessage(t, err), okLabel: t('common.ok') });
      } else {
        handleWalletPaymentError(err, fallbackStep);
      }
    } finally {
      setPaying(false);
    }
  }

  function openExternalPaymentOptions(invoice: ParsedInvoice, invoiceDescription?: string | null) {
    router.push({
      pathname: '/wallet-invoice',
      params: {
        invoice: invoice.invoice,
        role: 'received',
        external: '1',
        ...(invoiceDescription ? { description: invoiceDescription } : {}),
      },
    });
  }

  async function prepareExternalInvoice(openInSecondaryPage = false) {
    if (!lnurlRequest || !amountSats || paying || preparingExternalInvoiceRef.current) return;
    preparingExternalInvoiceRef.current = true;
    setPaying(true);
    try {
      const invoice = await requestLnurlPayInvoice(lnurlRequest, amountSats, description);
      if (openInSecondaryPage) {
        openExternalPaymentOptions(invoice, description);
        return;
      }
      setReviewInvoice(invoice);
      setStep('review');
    } catch (err) {
      void platform.confirmationDialog.notify({ title: lnurlErrorMessage(t, err), okLabel: t('common.ok') });
    } finally {
      preparingExternalInvoiceRef.current = false;
      setPaying(false);
    }
  }

  async function pasteInvoice() {
    const text = await getStringAsync();
    if (text.trim()) {
      handledScanRef.current = true;
      void acceptPaymentInput(text, 'manual', true);
    }
  }

  function handleScanned(data: string) {
    if (handledScanRef.current) return;
    handledScanRef.current = true;
    void acceptPaymentInput(data, 'scan', true);
  }

  function openManualInput() {
    handledScanRef.current = true;
    setStep('manual');
  }

  function resetScan() {
    handledScanRef.current = false;
    setPaymentInput('');
    setAmount('');
    setDescription('');
    setDraftDescription('');
    setDescriptionOpen(false);
    setPaymentConfirmOpen(false);
    setLnurlRequest(null);
    setReviewInvoice(null);
    paymentIntentRef.current = null;
    paymentConfirmedRef.current = false;
    paymentWalletRef.current = null;
    paymentPinAuthorizationRef.current = null;
    paymentPinApprovedRef.current = false;
    setPaymentPinOpen(false);
    setPaymentWalletId(null);
    setStep('scan');
  }

  function handleManualInput(nextInput: string) {
    setPaymentInput(nextInput);
  }

  function handleManualNext() {
    void acceptPaymentInput(paymentInput, 'manual', true);
  }

  function appendAmountDigit(digit: string) {
    setAmount((prev) => {
      if (digit === '00' && (!prev || prev === '0')) return prev;
      if (prev === '0') return digit;
      const next = `${prev}${digit}`;
      return clampAmountInput(next, lnurlRequest);
    });
  }

  function deleteAmountDigit() {
    setAmount((prev) => prev.slice(0, -1));
  }

  function openDescription() {
    setDraftDescription(description);
    setDescriptionOpen(true);
  }

  function saveDescription() {
    const limit = lnurlRequest?.commentAllowed ?? 0;
    const nextDescription = draftDescription.trim();
    setDescription(limit > 0 ? nextDescription.slice(0, limit) : '');
    setDescriptionOpen(false);
  }

  async function scanImageFromLibrary() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 1,
    });
    if (result.canceled) return;
    try {
      const barcodes = await scanFromURLAsync(result.assets[0].uri, ['qr']);
      const data = barcodes.find((barcode) => barcode.data.trim())?.data;
      if (!data) {
        void platform.confirmationDialog.notify({ title: t('wallet.no_qr_found'), okLabel: t('common.ok') });
        return;
      }
      handledScanRef.current = true;
      void acceptPaymentInput(data, 'scan', true);
    } catch {
      void platform.confirmationDialog.notify({ title: t('wallet.no_qr_found'), okLabel: t('common.ok') });
    }
  }

  function handleWalletPaymentError(err: unknown, fallbackStep: SendStep) {
    if (err instanceof WalletError && err.kind === 'timeout') {
      void platform.confirmationDialog
        .notify({
          title: t('wallet.payment_status_unknown_title'),
          message: t('wallet.payment_status_unknown_message'),
          okLabel: t('common.done'),
        })
        .then(() => {
          router.replace('/wallet');
        });
      return;
    }
    setStep(fallbackStep);
    void platform.confirmationDialog.notify({ title: walletErrorMessage(t, err as WalletError), okLabel: t('common.ok') });
  }

  const paymentAmount = lnurlRequest && amount
    ? `${Number(amount).toLocaleString()} ${t('wallet.sats_unit')}`
    : reviewInvoice
      ? formatSats(reviewInvoice.amountMsat, t('wallet.sats_unit'), t('wallet.unknown'))
      : t('wallet.unknown');
  const paymentDescription = lnurlRequest ? description : reviewInvoice?.description;

  return (
    <AppScreen edges={[]}>
      {step === 'manual' ? (
        <ScrollView {...scrollProps} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing.lg, paddingTop: titleClearance + spacing.lg, gap: spacing.xl }}>
          <AppInput
            description={t('wallet.send_hint')}
            value={paymentInput}
            onChangeText={handleManualInput}
            autoCapitalize="none"
            autoCorrect={false}
            invalid={paymentInput.trim().length > 0 && !manualInputValid}
            placeholder={t('wallet.send_placeholder')}
          />

          <View style={{ gap: spacing.md }}>
            <AppButton label={t('wallet.next')} variant="primary" disabled={!manualInputValid} loading={resolving} onPress={handleManualNext} />
            <AppButton label={t('wallet.scan_invoice')} variant="secondary" onPress={resetScan} />
          </View>
        </ScrollView>
      ) : step === 'amount' && lnurlRequest ? (
        <View
          style={{
            flex: 1,
            padding: spacing.lg,
            paddingTop: titleClearance + spacing.lg,
            paddingBottom: Math.max(insets.bottom + spacing.lg, spacing['2xl']),
          }}
        >
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.lg }}>
            <View style={{ maxWidth: '100%', alignItems: 'center', gap: spacing.md }}>
              <View style={{ maxWidth: '100%', alignItems: 'center', gap: spacing.xs }}>
                <AppText variant="caption" tone="muted" align="center" numberOfLines={1}>
                  {lnurlRequest.target}
                </AppText>
                <WalletAmountDisplay
                  amount={`${amount ? Number(amount).toLocaleString() : '0'} ${t('wallet.sats_unit')}`}
                />
              </View>
              {lnurlRequest.commentAllowed > 0 ? (
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
              ) : null}
            </View>
          </View>

          <View style={{ gap: spacing.lg }}>
            <View style={{ gap: spacing.sm }}>
              <KeypadRow digits={['1', '2', '3']} onPress={appendAmountDigit} />
              <KeypadRow digits={['4', '5', '6']} onPress={appendAmountDigit} />
              <KeypadRow digits={['7', '8', '9']} onPress={appendAmountDigit} />
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <KeypadDigit digit="00" onPress={appendAmountDigit} />
                <KeypadDigit digit="0" onPress={appendAmountDigit} />
                <View style={{ flex: 1 }}>
                  <AppButton
                    variant="secondary"
                    size="xl"
                    disabled={!amount}
                    onPress={deleteAmountDigit}
                    iconLeft={<Delete size={22} color={c.text} />}
                    accessibilityLabel={t('wallet.delete_digit')}
                  />
                </View>
              </View>
            </View>

            {walletsLoaded && wallet ? (
              <ActionRow
                layout="vertical"
                confirm={{
                  label: t('wallet.continue'),
                  disabled: !amountValid || paying,
                  onPress: () => openPaymentConfirmation('lnurl'),
                }}
                dismiss={{
                  label: t('wallet.other_payment_options'),
                  disabled: !amountValid,
                  loading: paying,
                  onPress: () => void prepareExternalInvoice(true),
                }}
              />
            ) : (
              <AppButton
                label={t('wallet.continue')}
                variant="primary"
                size="lg"
                disabled={!amountValid || !walletsLoaded}
                loading={paying}
                onPress={() => void prepareExternalInvoice()}
              />
            )}
          </View>
        </View>
      ) : step === 'payment' ? (
        <View
          style={{
            flex: 1,
            padding: spacing.lg,
            paddingTop: titleClearance + spacing.lg,
            paddingBottom: Math.max(insets.bottom + spacing.lg, spacing['2xl']),
          }}
        >
          <WalletPaymentStatus
            status={paymentStatus}
            amount={paymentAmount}
            processingLabel={t('wallet.payment_processing')}
            successTitle={t('wallet.payment_sent')}
            actionLabel={t('common.close')}
            onAction={() => router.back()}
          />
        </View>
      ) : step === 'review' && reviewInvoice ? (
        <ScrollView
          {...scrollProps}
          contentContainerStyle={{
            flexGrow: 1,
            padding: spacing.lg,
            paddingTop: titleClearance + spacing.lg,
            paddingBottom: Math.max(insets.bottom + spacing.lg, spacing['2xl']),
          }}
        >
          <View style={{ flex: 1, justifyContent: 'space-between', gap: spacing.xl }}>
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
              <AppText variant="caption" tone="muted" align="center">
                {t('wallet.invoice_amount')}
              </AppText>
              <WalletAmountDisplay
                amount={formatSats(reviewInvoice.amountMsat, t('wallet.sats_unit'), t('wallet.unknown'))}
              />
              <View style={{ maxWidth: '100%', alignItems: 'center', gap: spacing.xs }}>
                {reviewInvoice.description ? (
                  <AppText variant="body" align="center" numberOfLines={2}>
                    {reviewInvoice.description}
                  </AppText>
                ) : null}
                <AppText variant="caption" tone="muted" align="center">
                  {t('wallet.expires_in')}: {formatExpiryCountdown(reviewInvoice.expiresAt, nowMs, t)}
                </AppText>
              </View>
            </View>

            {walletsLoaded ? (
              wallet ? (
                <View style={{ gap: spacing.md }}>
                  <AppText variant="caption" tone="muted" align="center">
                    {t('wallet.local_auth_hint')}
                  </AppText>
                  <ActionRow
                    layout="vertical"
                    confirm={{
                      label: t('wallet.continue'),
                      onPress: () => openPaymentConfirmation('invoice'),
                    }}
                    dismiss={{
                      label: t('wallet.other_payment_options'),
                      onPress: () => openExternalPaymentOptions(reviewInvoice, reviewInvoice.description),
                    }}
                  />
                </View>
              ) : (
                <ExternalInvoicePayment invoice={reviewInvoice.invoice} />
              )
            ) : null}
          </View>
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>
          {resolving ? (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl, paddingTop: titleClearance + spacing.xl, gap: spacing.md }}>
              <ActivityIndicator color={c.textMuted} />
              <AppText variant="body" tone="muted" align="center">
                {t('wallet.resolving_payment')}
              </AppText>
            </View>
          ) : permission?.granted ? (
            <CameraView
              style={{ flex: 1 }}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={(r) => handleScanned(r.data)}
            />
          ) : (
            <View style={{ flex: 1, justifyContent: 'center', padding: spacing.xl, paddingTop: titleClearance + spacing.xl, gap: spacing.lg }}>
              <Scanner size={48} color={c.textMuted} />
              <AppText variant="title" weight="semibold">
                {t('scan.title')}
              </AppText>
              <AppText variant="body" tone="muted">
                {t('scan.permission')}
              </AppText>
              <AppButton label={t('scan.allow_camera')} variant="primary" onPress={() => void requestPermission()} />
            </View>
          )}

          {permission?.granted && !resolving ? (
            <View
              style={{
                position: 'absolute',
                start: 0,
                end: 0,
                bottom: 0,
                paddingHorizontal: spacing.lg,
                paddingBottom: insets.bottom + spacing.xl,
              }}
            >
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <View style={{ flex: 1, alignItems: 'center' }}>
                  <RoundOverlayAction
                    label={t('wallet.paste')}
                    icon={<ClipboardPaste size={24} color={c.onOverlay} />}
                    onPress={pasteInvoice}
                  />
                </View>
                <View style={{ flex: 1, alignItems: 'center' }}>
                  <RoundOverlayAction
                    label={t('wallet.manual_short')}
                    icon={<Keyboard size={24} color={c.onOverlay} />}
                    onPress={openManualInput}
                  />
                </View>
                <View style={{ flex: 1, alignItems: 'center' }}>
                  <RoundOverlayAction
                    label={t('wallet.photos_short')}
                    icon={<Image size={24} color={c.onOverlay} />}
                    onPress={scanImageFromLibrary}
                  />
                </View>
              </View>
            </View>
          ) : null}
        </View>
      )}
      {step === 'scan' ? (
        <ScannerCloseButton onClose={() => router.back()} />
      ) : (
        <ScreenHeader bordered={(step === 'manual' || step === 'review') && scrolled} title={t('wallet.send')} />
      )}
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
          maxLength={lnurlRequest?.commentAllowed || undefined}
          multiline
        />
        <ActionRow
          layout="horizontal"
          dismiss={{ label: t('common.cancel'), onPress: () => setDescriptionOpen(false) }}
          confirm={{ label: t('common.done'), onPress: saveDescription }}
        />
      </BottomSheet>
      <WalletPaymentConfirmSheet
        visible={paymentConfirmOpen}
        amount={paymentAmount}
        description={paymentDescription}
        wallets={wallets}
        selectedWalletId={paymentWalletId}
        onClose={() => setPaymentConfirmOpen(false)}
        onClosed={handlePaymentConfirmClosed}
        onConfirm={confirmPayment}
        onSelectWallet={selectPaymentWallet}
      />
      <WalletPinSheet
        visible={paymentPinOpen}
        mode={paymentPinMode}
        onClose={closePaymentPin}
        onClosed={handlePaymentPinClosed}
        onSubmit={submitPaymentPin}
      />
    </AppScreen>
  );
}

function firstParam(value: RouteParam, maxLength: number): string {
  return routeStringParam(value, maxLength) ?? '';
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

function extractPaymentInput(input: string): string {
  return normalizeLightningInput(input);
}

function parseProfilePaymentTarget(input: string): ParsedNostrProfileInput | null {
  try {
    return parseNostrProfileInput(input);
  } catch {
    return null;
  }
}

function isLikelyProfilePaymentTarget(input: string): boolean {
  return parseProfilePaymentTarget(extractPaymentInput(input)) != null;
}

async function resolvePaymentAddress(input: string): Promise<LnurlPayRequest> {
  try {
    return await resolveLnurlPayTarget(input);
  } catch (err) {
    const nip05Target = await resolveNip05PaymentTarget(input);
    if (!nip05Target) throw err;
    return resolveLnurlPayTarget(nip05Target);
  }
}

async function resolveNip05PaymentTarget(input: string): Promise<string | null> {
  if (!isNip05Identifier(input)) return null;
  const resolved = await queryNip05Profile(input);
  if (!resolved) return null;
  return resolveProfilePaymentTarget({ pubkey: resolved.pubkey, relays: resolved.relays ?? [] });
}

async function resolveProfilePaymentTarget(target: ParsedNostrProfileInput): Promise<string> {
  let profile = await getProfile(target.pubkey);
  let paymentTarget = profile?.lud16 || profile?.lud06 || null;
  if (paymentTarget) return paymentTarget;

  try {
    await fetchProfile(target.pubkey, target.relays);
  } catch {
    throw new ProfilePaymentError('profile_unreachable', displayNameForPaymentTarget(target.pubkey, profile));
  }

  profile = await getProfile(target.pubkey);
  paymentTarget = profile?.lud16 || profile?.lud06 || null;
  if (paymentTarget) return paymentTarget;
  throw new ProfilePaymentError('no_lightning_address', displayNameForPaymentTarget(target.pubkey, profile));
}

function displayNameForPaymentTarget(pubkey: string, profile: Awaited<ReturnType<typeof getProfile>>): string {
  return resolveName(profile) ?? abbreviateNpub(pubkeyToNpub(pubkey));
}

function parseInvoiceInput(input: string): ReturnType<typeof parseBolt11Invoice> {
  return parseBolt11Invoice(extractPaymentInput(input));
}

function parseSatsAmount(input: string): number | null {
  if (!/^\d+$/.test(input.trim())) return null;
  const value = Number(input);
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  return value;
}

function defaultAmountFor(request: LnurlPayRequest): string {
  const minSats = Math.ceil(request.minSendableMsat / 1000);
  const maxSats = Math.floor(request.maxSendableMsat / 1000);
  if (minSats === maxSats) return String(minSats);
  return '';
}

function paymentMetadata(description: string, target: string): Record<string, unknown> | undefined {
  const comment = description.trim();
  const metadata: Record<string, unknown> = {
    recipient_data: { identifier: target },
  };
  if (comment) {
    metadata.comment = comment;
    metadata.description = comment;
  }
  return metadata;
}

function clampAmountInput(input: string, request: LnurlPayRequest | null): string {
  const digits = input.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  if (!digits) return '';
  const value = Number(digits);
  const maxSats = request ? Math.floor(request.maxSendableMsat / 1000) : Number.MAX_SAFE_INTEGER;
  if (!Number.isFinite(value)) return String(maxSats);
  return String(Math.min(value, maxSats));
}

function formatExpiryCountdown(
  expiresAt: number | null,
  nowMs: number,
  t: (key: string) => string,
): string {
  if (!expiresAt) return t('wallet.unknown');
  const remainingSeconds = Math.max(0, Math.floor(expiresAt - nowMs / 1000));
  if (remainingSeconds <= 0) return t('wallet.expired');
  const hours = Math.floor(remainingSeconds / 3600);
  const minutes = Math.floor((remainingSeconds % 3600) / 60);
  const seconds = remainingSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}


function walletErrorMessage(t: (key: string) => string, err: WalletError): string {
  switch (err.kind) {
    case 'authentication_unavailable':
      return t('wallet.auth_unavailable');
    case 'authentication_failed':
      return t('wallet.auth_failed');
    case 'timeout':
      return t('wallet.wallet_timeout');
    case 'wallet_offline':
      return t('wallet.wallet_offline');
    case 'rate_limited':
      return t('wallet.rate_limited');
    case 'permission_denied':
      return t('wallet.permission_denied');
    default:
      return err.message || t('wallet.payment_failed');
  }
}

function lnurlErrorMessage(t: (key: string) => string, err: unknown): string {
  if (!(err instanceof LnurlError)) return t('wallet.payment_request_failed');
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
      return err.message || t('wallet.payment_request_failed');
  }
}

function showProfilePaymentError(t: (key: string, opts?: Record<string, string>) => string, err: unknown) {
  if (err instanceof ProfilePaymentError && err.kind === 'no_lightning_address') {
    void platform.confirmationDialog.notify({
      title: t('wallet.no_lightning_address_title'),
      message: t('wallet.no_lightning_address_message', { name: err.name }),
      okLabel: t('common.ok'),
    });
    return;
  }
  void platform.confirmationDialog.notify({ title: t('wallet.payment_target_unreachable'), okLabel: t('common.ok') });
}
