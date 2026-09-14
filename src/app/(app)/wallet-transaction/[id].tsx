import { useLocalSearchParams } from 'expo-router';
import dayjs from 'dayjs';
import Check from 'lucide-react-native/icons/check';
import { Copy } from '@solar-icons/react-native/category/ui/Linear/Copy';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { ListGroup } from '@/components/common/ListGroup';
import { ListRow } from '@/components/common/ListRow';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { InvalidRouteRedirect } from '@/components/navigation/InvalidRouteRedirect';
import { WalletAmountDisplay } from '@/components/wallet/WalletAmountDisplay';
import { useScrolled } from '@/hooks/use-scrolled';
import { useWalletTransaction } from '@/hooks/use-wallets';
import { setStringAsync } from '@/lib/clipboard';
import { routeOpaqueIdParam } from '@/lib/navigation/route-params';
import { walletDescriptionText } from '@/lib/wallet/description';
import { formatSats } from '@/services/wallet/bolt11';
import { iconStrokeWidth } from '@/theme/icons';
import { spacing, useThemeColors } from '@/theme';

export default function WalletTransactionDetailScreen() {
  const { scrolled, scrollProps } = useScrolled();
  const { t } = useTranslation();
  const c = useThemeColors();
  const titleClearance = useScreenHeaderClearance();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const parsedId = routeOpaqueIdParam(params.id);
  const id = parsedId ?? '';
  const { transaction: tx, loaded } = useWalletTransaction(id);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const incoming = tx?.type === 'incoming';
  const outgoing = tx?.type === 'outgoing';
  const pending = tx ? isPendingTransaction(tx.state) : false;
  const unsuccessful = tx ? isUnsuccessfulTransaction(tx.state) : false;
  const amountColor = unsuccessful ? c.danger : pending ? c.warning : incoming ? c.success : c.text;
  const signedAmount = tx
    ? formatSignedSats(
        tx.amountMsat,
        incoming,
        outgoing,
        t('wallet.sats_unit'),
        t('wallet.unknown'),
      )
    : '';
  const statusLabel = tx ? formatTransactionStatus(t, tx.state, incoming, outgoing, tx.settledAt, tx.preimage) : '';
  const description = walletDescriptionText(tx?.description);

  async function copy(field: string, value: string | null) {
    if (!value) return;
    await setStringAsync(value);
    setCopiedField(field);
    setTimeout(() => setCopiedField((current) => (current === field ? null : current)), 1800);
  }

  if (!parsedId) return <InvalidRouteRedirect />;

  return (
    <AppScreen edges={[]}>
      <ScrollView {...scrollProps} contentContainerStyle={{ padding: spacing.lg, paddingTop: titleClearance + spacing.lg, gap: spacing.xl }}>
        {!loaded ? (
          <View style={{ flex: 1 }} />
        ) : tx ? (
          <>
            <WalletAmountDisplay amount={signedAmount} color={amountColor} />

            <ListGroup>
              <ListRow title={t('wallet.status')} value={statusLabel} />
              {description ? (
                <ListRow title={t('wallet.description')} value={description} valueMultiline />
              ) : null}
              {tx.feesPaidMsat != null ? (
                <ListRow
                  title={t('wallet.fee')}
                  value={formatSats(tx.feesPaidMsat, t('wallet.sats_unit'), t('wallet.unknown'))}
                />
              ) : null}
              <ListRow title={t('wallet.created_at')} value={formatDetailTime(tx.createdAt)} />
              {tx.settledAt ? <ListRow title={t('wallet.settled_at')} value={formatDetailTime(tx.settledAt)} /> : null}
              {tx.expiresAt ? <ListRow title={t('wallet.expires_at')} value={formatDetailTime(tx.expiresAt)} /> : null}
            </ListGroup>

            {tx.invoice || tx.paymentHash || tx.preimage ? (
              <ListGroup>
                {tx.invoice ? (
                  <CopyableDetailRow
                    title={t('wallet.invoice')}
                    value={tx.invoice}
                    copied={copiedField === 'invoice'}
                    onCopy={() => void copy('invoice', tx.invoice)}
                  />
                ) : null}
                {tx.paymentHash ? (
                  <CopyableDetailRow
                    title={t('wallet.payment_hash')}
                    value={tx.paymentHash}
                    copied={copiedField === 'payment_hash'}
                    onCopy={() => void copy('payment_hash', tx.paymentHash)}
                  />
                ) : null}
                {tx.preimage ? (
                  <CopyableDetailRow
                    title={t('wallet.preimage')}
                    value={tx.preimage}
                    copied={copiedField === 'preimage'}
                    onCopy={() => void copy('preimage', tx.preimage)}
                  />
                ) : null}
              </ListGroup>
            ) : null}
          </>
        ) : (
          <AppText variant="body" tone="muted" align="center">
            {t('wallet.transaction_missing')}
          </AppText>
        )}
      </ScrollView>
      <ScreenHeader bordered={scrolled} title={t('wallet.transaction')} />
    </AppScreen>
  );
}

function isPendingTransaction(state: string): boolean {
  return state === 'pending' || state === 'accepted';
}

function isUnsuccessfulTransaction(state: string): boolean {
  return state === 'canceled' || state === 'cancelled' || state === 'failed' || state === 'error';
}

function isSettledTransaction(state: string, settledAt: number | null, preimage: string | null): boolean {
  return state === 'settled' || state === 'paid' || state === 'success' || settledAt != null || preimage != null;
}

function formatTransactionStatus(
  t: (key: string) => string,
  state: string,
  incoming: boolean,
  outgoing: boolean,
  settledAt: number | null,
  preimage: string | null,
): string {
  if (isPendingTransaction(state)) return t('wallet.pending');
  if (isUnsuccessfulTransaction(state)) return t('wallet.invoice_status_failed');
  if (state === 'expired') return t('wallet.expired');
  if (isSettledTransaction(state, settledAt, preimage)) {
    if (incoming) return t('wallet.received');
    if (outgoing) return t('wallet.sent');
    return t('wallet.invoice_status_paid');
  }
  return t('wallet.unknown');
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

function formatSignedSats(
  msat: number | null,
  incoming: boolean,
  outgoing: boolean,
  unit: string,
  unknown: string,
): string {
  if (msat == null) return unknown;
  const amount = formatSats(Math.abs(msat), unit, unknown);
  if (incoming) return `+${amount}`;
  if (outgoing) return `-${amount}`;
  return amount;
}

function formatDetailTime(ts: number): string {
  return dayjs.unix(ts).format('YYYY-MM-DD HH:mm');
}

function shorten(value: string): string {
  if (value.length <= 24) return value;
  return `${value.slice(0, 12)}…${value.slice(-8)}`;
}
