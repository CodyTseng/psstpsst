import { router, useLocalSearchParams } from 'expo-router';
import dayjs from 'dayjs';
import Check from 'lucide-react-native/icons/check';
import { Copy } from '@solar-icons/react-native/category/ui/Linear/Copy';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppButton } from '@/components/common/AppButton';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { ListGroup } from '@/components/common/ListGroup';
import { ListRow } from '@/components/common/ListRow';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { WalletAmountDisplay } from '@/components/wallet/WalletAmountDisplay';
import { WalletPaymentConfirmSheet } from '@/components/wallet/WalletPaymentConfirmSheet';
import { WalletPaymentStatus, type WalletPaymentStatusValue } from '@/components/wallet/WalletPaymentStatus';
import { useScrolled } from '@/hooks/use-scrolled';
import { useInvoiceTransaction } from '@/hooks/use-invoice-transaction';
import { useWallets } from '@/hooks/use-wallets';
import { setStringAsync } from '@/lib/clipboard';
import { routeStringParam, type RouteParam } from '@/lib/navigation/route-params';
import { walletDescriptionText } from '@/lib/wallet/description';
import { invoiceStatus, type InvoiceStatus } from '@/lib/wallet/invoice-status';
import { platform } from '@/platform';
import { formatSats, parseBolt11Invoice, type ParsedInvoice } from '@/services/wallet/bolt11';
import {
  cacheLocalInvoiceTransaction,
  lookupInvoiceStatus,
  payInvoice,
  refreshWallet,
  tryCacheLocalInvoiceTransaction,
  WalletError,
  type WalletRow,
} from '@/services/wallet/wallet.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { iconStrokeWidth } from '@/theme/icons';
import { spacing, useThemeColors } from '@/theme';

export default function WalletInvoiceScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const titleClearance = useScreenHeaderClearance();
  const params = useLocalSearchParams<{
    invoice?: string | string[];
    role?: string | string[];
    description?: string | string[];
  }>();
  const invoiceInput = firstParam(params.invoice, 8_192);
  const role = firstParam(params.role, 16);
  const messageDescription = firstParam(params.description, 2_048);
  const isSender = role === 'sent';
  const accountPubkey = useActiveAccount((s) => s.activePubkey);
  const { wallets, loaded: walletLoaded } = useWallets(accountPubkey);
  const wallet = wallets.find((candidate) => candidate.isDefault) ?? wallets[0] ?? null;
  const parsedInvoice = useMemo(() => parseInvoiceParam(invoiceInput), [invoiceInput]);
  const { transaction } = useInvoiceTransaction(accountPubkey, parsedInvoice?.invoice);
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));
  const [paymentStatus, setPaymentStatus] = useState<'idle' | WalletPaymentStatusValue>('idle');
  const { scrolled, scrollProps } = useScrolled({ resetKey: paymentStatus });
  const [paymentConfirmOpen, setPaymentConfirmOpen] = useState(false);
  const [paymentWalletId, setPaymentWalletId] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const paymentConfirmedRef = useRef(false);
  const paymentWalletRef = useRef<WalletRow | null>(null);

  const status = parsedInvoice
    ? invoiceStatus(parsedInvoice, transaction, nowSeconds, {
        canVerifyPayment: walletLoaded ? !!wallet : true,
      })
    : null;
  const payable =
    !!parsedInvoice &&
    !isSender &&
    ((status === 'pending' && !!wallet) || (status === 'unknown' && walletLoaded && !wallet));
  const description =
    walletDescriptionText(transaction?.description) ??
    walletDescriptionText(parsedInvoice?.description) ??
    walletDescriptionText(messageDescription);
  const paymentHash = transaction?.paymentHash || parsedInvoice?.paymentHash || null;
  const preimage = transaction?.preimage ?? null;
  const createdAt = transaction?.createdAt ?? parsedInvoice?.createdAt ?? null;
  const settledAt = transaction?.settledAt ?? null;
  const expiresAt = transaction?.expiresAt ?? parsedInvoice?.expiresAt ?? null;
  const displayAmount = parsedInvoice
    ? formatSats(parsedInvoice.amountMsat, t('wallet.sats_unit'), t('wallet.unknown'))
    : t('wallet.unknown');

  useEffect(() => {
    if (!parsedInvoice?.expiresAt || parsedInvoice.expiresAt <= nowSeconds) return;
    const timer = setInterval(() => setNowSeconds(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, [parsedInvoice?.expiresAt, nowSeconds]);

  useEffect(() => {
    if (!wallet || !parsedInvoice || status !== 'pending') return;
    let cancelled = false;
    void lookupInvoiceStatus(wallet, {
      invoice: parsedInvoice.invoice,
      paymentHash: transaction?.paymentHash ?? parsedInvoice.paymentHash,
    })
      .then((nextStatus) => {
        if (cancelled || (nextStatus !== 'settled' && nextStatus !== 'expired')) return;
        void tryCacheLocalInvoiceTransaction(wallet, {
          invoice: parsedInvoice.invoice,
          type: isSender ? 'incoming' : 'outgoing',
          state: nextStatus === 'settled' ? 'settled' : 'expired',
          paymentHash: transaction?.paymentHash ?? parsedInvoice.paymentHash,
          amountMsat: parsedInvoice.amountMsat,
          description: description ?? parsedInvoice.description,
          createdAt: parsedInvoice.createdAt,
          expiresAt: parsedInvoice.expiresAt,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [description, isSender, parsedInvoice, status, transaction?.paymentHash, wallet]);

  async function copy(field: string, value: string | null | undefined) {
    if (!value) return;
    await setStringAsync(value);
    setCopiedField(field);
    setTimeout(() => setCopiedField((current) => (current === field ? null : current)), 1800);
  }

  function handlePrimaryAction() {
    if (!parsedInvoice) return;
    if (!wallet) {
      router.push('/wallet');
      return;
    }
    if (paymentStatus !== 'idle') return;
    const paymentWallet =
      wallets.find((candidate) => candidate.id === paymentWalletId) ?? wallet;
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
    if (!paymentWalletRef.current || !parsedInvoice || paymentStatus !== 'idle') return;
    paymentConfirmedRef.current = true;
    setPaymentStatus('processing');
    setPaymentConfirmOpen(false);
  }

  function handlePaymentConfirmClosed() {
    if (!paymentConfirmedRef.current) return;
    paymentConfirmedRef.current = false;
    setTimeout(() => {
      void executePayment();
    }, 0);
  }

  async function executePayment() {
    const paymentWallet = paymentWalletRef.current;
    if (!paymentWallet || !parsedInvoice) {
      setPaymentStatus('idle');
      return;
    }
    try {
      const result = await payInvoice(paymentWallet, parsedInvoice.invoice, {
        prompt: t('wallet.auth_prompt'),
        cancel: t('common.cancel'),
      });
      const now = Math.floor(Date.now() / 1000);
      const nwcResult = result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
      await cacheLocalInvoiceTransaction(paymentWallet, {
        invoice: parsedInvoice.invoice,
        type: 'outgoing',
        state: 'settled',
        paymentHash: stringValue(nwcResult.payment_hash) ?? parsedInvoice.paymentHash,
        preimage: stringValue(nwcResult.preimage),
        amountMsat: parsedInvoice.amountMsat,
        description: description ?? parsedInvoice.description,
        createdAt: parsedInvoice.createdAt,
        expiresAt: parsedInvoice.expiresAt,
        settledAt: now,
        raw: nwcResult,
      });
      void refreshWallet(paymentWallet).catch(() => {});
      setPaymentStatus('success');
    } catch (err) {
      setPaymentStatus('idle');
      void platform.confirmationDialog.notify({ title: walletErrorMessage(t, err as WalletError), okLabel: t('common.ok') });
    }
  }

  return (
    <AppScreen edges={[]}>
      {parsedInvoice && paymentStatus !== 'idle' ? (
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
            amount={displayAmount}
            processingLabel={t('wallet.payment_processing')}
            successTitle={t('wallet.payment_sent')}
            actionLabel={t('common.close')}
            onAction={() => router.back()}
          />
        </View>
      ) : (
        <ScrollView {...scrollProps} contentContainerStyle={{ padding: spacing.lg, paddingTop: titleClearance + spacing.lg, gap: spacing.xl }}>
          {parsedInvoice ? (
          <>
            <View style={{ alignItems: 'center', gap: spacing.md }}>
              <WalletAmountDisplay amount={displayAmount} />
            </View>

            <ListGroup>
              <ListRow
                title={t('wallet.status')}
                value={status ? statusLabel(t, status, isSender) : t('wallet.unknown')}
                valueTone={status ? statusValueTone(status) : 'muted'}
              />
              {description ? (
                <ListRow title={t('wallet.description')} value={description} valueMultiline />
              ) : null}
              {transaction?.feesPaidMsat != null ? (
                <ListRow
                  title={t('wallet.fee')}
                  value={formatSats(transaction.feesPaidMsat, t('wallet.sats_unit'), t('wallet.unknown'))}
                />
              ) : null}
              {createdAt ? (
                <ListRow title={t('wallet.created_at')} value={formatDetailTime(createdAt)} />
              ) : null}
              {settledAt ? (
                <ListRow title={t('wallet.settled_at')} value={formatDetailTime(settledAt)} />
              ) : null}
              {expiresAt ? (
                <ListRow title={t('wallet.expires_at')} value={formatDetailTime(expiresAt)} />
              ) : null}
            </ListGroup>

            <ListGroup>
              <CopyableDetailRow
                title={t('wallet.invoice')}
                value={parsedInvoice.invoice}
                copied={copiedField === 'invoice'}
                onCopy={() => void copy('invoice', parsedInvoice.invoice)}
              />
              {paymentHash ? (
                <CopyableDetailRow
                  title={t('wallet.payment_hash')}
                  value={paymentHash}
                  copied={copiedField === 'payment_hash'}
                  onCopy={() => void copy('payment_hash', paymentHash)}
                />
              ) : null}
              {preimage ? (
                <CopyableDetailRow
                  title={t('wallet.preimage')}
                  value={preimage}
                  copied={copiedField === 'preimage'}
                  onCopy={() => void copy('preimage', preimage)}
                />
              ) : null}
            </ListGroup>

            {payable ? (
              <AppButton
                label={wallet ? t('wallet.continue') : t('wallet.connect')}
                variant="primary"
                size="lg"
                onPress={handlePrimaryAction}
              />
            ) : null}
          </>
        ) : (
          <AppText variant="body" tone="muted" align="center">
            {t('wallet.invalid_invoice')}
          </AppText>
          )}
        </ScrollView>
      )}
      <ScreenHeader bordered={paymentStatus === 'idle' && scrolled} title={t('wallet.invoice')} />
      <WalletPaymentConfirmSheet
        visible={paymentConfirmOpen}
        amount={displayAmount}
        description={description}
        wallets={wallets}
        selectedWalletId={paymentWalletId}
        onClose={() => setPaymentConfirmOpen(false)}
        onClosed={handlePaymentConfirmClosed}
        onConfirm={confirmPayment}
        onSelectWallet={selectPaymentWallet}
      />
    </AppScreen>
  );
}

function firstParam(value: RouteParam, maxLength: number): string {
  return routeStringParam(value, maxLength) ?? '';
}

function parseInvoiceParam(value: string): ParsedInvoice | null {
  if (!value.trim()) return null;
  try {
    return parseBolt11Invoice(value);
  } catch {
    return null;
  }
}

function statusLabel(
  t: (key: string) => string,
  status: InvoiceStatus,
  isSender: boolean,
): string {
  switch (status) {
    case 'paid':
      return t('wallet.invoice_status_paid');
    case 'expired':
      return t('wallet.expired');
    case 'failed':
      return t('wallet.invoice_status_failed');
    case 'unknown':
      return t('wallet.invoice_status_unknown');
    default:
      return isSender ? t('wallet.invoice_status_waiting') : t('wallet.invoice_status_unpaid');
  }
}

function statusValueTone(status: InvoiceStatus): 'muted' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'paid':
      return 'success';
    case 'failed':
      return 'danger';
    case 'pending':
      return 'warning';
    default:
      return 'muted';
  }
}

function CopyableDetailRow({
  title,
  value,
  copied,
  onCopy,
}: {
  title: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  const c = useThemeColors();
  return (
    <ListRow
      title={title}
      value={shorten(value)}
      trailing={
        copied ? (
          <Check strokeWidth={iconStrokeWidth.default} size={18} color={c.success} />
        ) : (
          <Copy size={18} color={c.textMuted} />
        )
      }
      onPress={onCopy}
    />
  );
}

function formatDetailTime(ts: number): string {
  return dayjs.unix(ts).format('YYYY-MM-DD HH:mm');
}

function shorten(value: string): string {
  if (value.length <= 24) return value;
  return `${value.slice(0, 12)}…${value.slice(-8)}`;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
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
