import { router } from 'expo-router';
import { DownloadMinimalistic as ArrowDownToLine } from '@solar-icons/react-native/category/arrows-action/Linear/DownloadMinimalistic';
import { UploadMinimalistic as ArrowUpFromLine } from '@solar-icons/react-native/category/arrows-action/Linear/UploadMinimalistic';
import { ClockCircle as Clock } from '@solar-icons/react-native/category/time/Linear/ClockCircle';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';

import { AppText } from '@/components/common/AppText';
import { formatListTime } from '@/lib/time';
import { walletDescriptionText } from '@/lib/wallet/description';
import { formatSats } from '@/services/wallet/bolt11';
import type { WalletTransactionRow as WalletTransaction } from '@/services/wallet/wallet.service';
import { radius, spacing, uiDensity, useThemeColors } from '@/theme';

type Props = {
  transaction: WalletTransaction;
  showSeparator?: boolean;
};

const ROW_HEIGHT = uiDensity.conversationRowHeight;
const ICON_SIZE = uiDensity.conversationAvatarSize;
const ICON_GLYPH_SIZE = 20;
const CONTENT_INSET = spacing.lg + ICON_SIZE + spacing.md;

export function WalletTransactionRow({ transaction, showSeparator = false }: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const incoming = transaction.type === 'incoming';
  const pending = isPendingTransaction(transaction.state);
  const title = pending ? t('wallet.pending') : incoming ? t('wallet.received') : t('wallet.sent');
  const color = pending ? c.warning : incoming ? c.success : c.text;
  const description = walletDescriptionText(transaction.description);
  const time = formatListTime(transaction.createdAt);

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        pressFeedback="delayed"
        onPress={() => router.push(`/wallet-transaction/${encodeURIComponent(transaction.id)}`)}
        style={({ pressed }) => ({
          height: ROW_HEIGHT,
          paddingHorizontal: spacing.lg,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          backgroundColor: pressed ? c.interactionOverlay : c.background,
        })}
      >
        <View
          style={{
            width: ICON_SIZE,
            height: ICON_SIZE,
            borderRadius: radius.full,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: color + '22',
          }}
        >
          {pending ? (
            <Clock size={ICON_GLYPH_SIZE} color={color} />
          ) : incoming ? (
            <ArrowDownToLine size={ICON_GLYPH_SIZE} color={color} />
          ) : (
            <ArrowUpFromLine size={ICON_GLYPH_SIZE} color={color} />
          )}
        </View>

        <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', gap: spacing.md }}>
          <View style={{ flex: 2, minWidth: 0, gap: spacing.xs }}>
            <AppText variant="subtitle" numberOfLines={1}>
              {title}
            </AppText>
            <AppText variant="caption" tone="muted" numberOfLines={1}>
              {time}
            </AppText>
          </View>

          <View style={{ flex: 3, minWidth: 0, gap: spacing.xs }}>
            <AppText
              variant="subtitle"
              align="end"
              numberOfLines={1}
              style={{ color }}
            >
              {formatSignedSats(
                transaction.amountMsat,
                incoming,
                t('wallet.sats_unit'),
                t('wallet.unknown'),
              )}
            </AppText>
            <AppText variant="caption" tone="muted" align="end" numberOfLines={1}>
              {description ?? ' '}
            </AppText>
          </View>
        </View>
      </Pressable>

      {showSeparator ? (
        <View
          style={{
            height: StyleSheet.hairlineWidth,
            marginStart: CONTENT_INSET,
            backgroundColor: c.border,
          }}
        />
      ) : null}
    </View>
  );
}

function isPendingTransaction(state: string): boolean {
  return state === 'pending' || state === 'accepted';
}

function formatSignedSats(msat: number | null, incoming: boolean, unit: string, unknown: string): string {
  if (msat == null) return unknown;
  const sign = incoming ? '+' : '-';
  return `${sign}${formatSats(Math.abs(msat), unit, unknown)}`;
}
