import { router } from 'expo-router';
import { BillList as ReceiptText } from '@solar-icons/react-native/category/money/Linear/BillList';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';

import { AppText } from '@/components/common/AppText';
import { useInvoiceTransaction } from '@/hooks/use-invoice-transaction';
import { useDefaultWallet } from '@/hooks/use-wallets';
import { walletDescriptionText } from '@/lib/wallet/description';
import { invoiceStatus, type InvoiceStatus } from '@/lib/wallet/invoice-status';
import { formatNumber, type ParsedInvoice } from '@/services/wallet/bolt11';
import { useActiveAccount } from '@/stores/active-account.store';
import { radius, spacing, useThemeColors } from '@/theme';

import { MessageCardFooter } from './MessageCardFooter';

type Props = {
  invoice: ParsedInvoice;
  isSelf: boolean;
  messageDescription?: string | null;
  metaSlot?: ReactNode;
};

export function InvoiceBubble({ invoice, isSelf, messageDescription, metaSlot }: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const accountPubkey = useActiveAccount((s) => s.activePubkey);
  const { wallet, loaded: walletLoaded } = useDefaultWallet(accountPubkey);
  const { transaction } = useInvoiceTransaction(accountPubkey, invoice.invoice);
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));
  const textColor = isSelf ? c.accentForeground : c.text;
  const mutedColor = isSelf ? c.accentForeground + 'B8' : c.textMuted;
  const iconBg = isSelf ? c.accentForeground + '26' : c.accentSoft;
  const iconColor = isSelf ? c.accentForeground : c.accent;
  const status = invoiceStatus(invoice, transaction, nowSeconds, {
    canVerifyPayment: walletLoaded ? !!wallet : true,
  });
  const description =
    walletDescriptionText(transaction?.description) ??
    walletDescriptionText(invoice.description) ??
    walletDescriptionText(messageDescription);
  const [amountValue, amountUnit] = invoiceAmountParts(
    invoice.amountMsat,
    t('wallet.sats_unit'),
    t('wallet.unknown'),
  );

  useEffect(() => {
    if (invoice.expiresAt == null || invoice.expiresAt <= nowSeconds) return;
    const delayMs = Math.min((invoice.expiresAt - nowSeconds) * 1000 + 1000, 2_147_483_647);
    const timer = setTimeout(() => setNowSeconds(Math.floor(Date.now() / 1000)), delayMs);
    return () => clearTimeout(timer);
  }, [invoice.expiresAt, nowSeconds]);

  function openInvoice() {
    const params = new URLSearchParams({
      invoice: invoice.invoice,
      role: isSelf ? 'sent' : 'received',
    });
    if (description) params.set('description', description);
    router.push(`/wallet-invoice?${params.toString()}`);
  }

  return (
    <View style={{ minWidth: 220, maxWidth: '100%' }}>
      <Pressable
        accessibilityRole="button"
        onPress={openInvoice}
        style={({ pressed }) => ({ gap: spacing.md, opacity: pressed ? 0.85 : 1 })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: radius.full,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: iconBg,
            }}
          >
            <ReceiptText size={20} color={iconColor} />
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: spacing.xs }}>
            <AppText variant="caption" weight="semibold" numberOfLines={1} style={{ color: mutedColor }}>
              {t(isSelf ? 'wallet.collection_request' : 'wallet.payment_request')}
            </AppText>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs, minWidth: 0 }}>
              <AppText
                variant="title"
                weight="semibold"
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.68}
                style={{ flexShrink: 1, minWidth: 0, color: textColor }}
              >
                {amountValue}
              </AppText>
              {amountUnit ? (
                <AppText
                  variant="caption"
                  weight="semibold"
                  numberOfLines={1}
                  style={{ flexShrink: 0, color: textColor }}
                >
                  {amountUnit}
                </AppText>
              ) : null}
            </View>
          </View>
        </View>

        {description ? (
          <AppText variant="body" numberOfLines={2} style={{ color: textColor }}>
            {description}
          </AppText>
        ) : null}
      </Pressable>

      <MessageCardFooter
        leading={
          <AppText
            variant="caption"
            weight="semibold"
            numberOfLines={1}
            style={{ color: mutedColor }}
          >
            {statusLabel(t, status, isSelf)}
          </AppText>
        }
        metaSlot={metaSlot}
      />
    </View>
  );
}

function invoiceAmountParts(amountMsat: number | null, unit: string, unknown: string): [string, string | null] {
  if (amountMsat == null) return [unknown, null];
  return [formatNumber(amountMsat / 1000), unit];
}

function statusLabel(
  t: (key: string) => string,
  status: InvoiceStatus,
  isSelf: boolean,
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
      return isSelf ? t('wallet.invoice_status_waiting') : t('wallet.invoice_status_unpaid');
  }
}
