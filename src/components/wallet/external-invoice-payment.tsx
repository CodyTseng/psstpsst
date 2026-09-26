import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/common/AppButton';
import { AppText } from '@/components/common/AppText';
import { QrCode } from '@/components/common/QrCode';
import { setStringAsync } from '@/lib/clipboard';
import { platform } from '@/platform';
import { showToast } from '@/stores/toast.store';
import { radius, spacing, useThemeColors } from '@/theme';

const QR_SIZE = 216;

export function ExternalInvoicePayment({
  invoice,
  showPaymentRequest = true,
}: {
  invoice: string;
  showPaymentRequest?: boolean;
}) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const [copied, setCopied] = useState(false);
  const lightningUri = `lightning:${invoice}`;

  async function copyInvoice() {
    await setStringAsync(invoice);
    setCopied(true);
  }

  async function openWalletApp() {
    const opened = await platform.urlOpener.openExternalUrl(lightningUri);
    if (!opened) showToast(t('wallet.open_wallet_failed'));
  }

  return (
    <View style={{ alignItems: 'center', gap: spacing.lg }}>
      {showPaymentRequest ? (
        <View style={{ alignSelf: 'stretch', gap: spacing.sm }}>
          <AppText variant="caption" tone="muted">
            {t('wallet.payment_request')}
          </AppText>
          <AppText variant="code" selectable>
            {invoice}
          </AppText>
          <AppButton
            label={copied ? t('wallet.copied') : t('wallet.copy_invoice')}
            variant="secondary"
            onPress={() => void copyInvoice()}
          />
        </View>
      ) : null}
      <View
        style={{
          padding: spacing.lg,
          backgroundColor: c.onOverlay,
          borderRadius: radius.lg,
        }}
      >
        <QrCode data={lightningUri} size={QR_SIZE} />
      </View>
      <AppText variant="body" tone="muted" align="center">
        {t('wallet.scan_invoice_hint')}
      </AppText>
      <AppButton
        label={t('wallet.open_wallet_app')}
        variant="primary"
        size="lg"
        onPress={() => void openWalletApp()}
      />
    </View>
  );
}
