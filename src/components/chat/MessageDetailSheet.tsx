import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronUp from 'lucide-react-native/icons/chevron-up';
import Check from 'lucide-react-native/icons/check';
import { Copy } from '@solar-icons/react-native/category/ui/Linear/Copy';
import { DangerCircle as CircleAlert } from '@solar-icons/react-native/category/ui/Linear/DangerCircle';
import { ClockCircle as Clock } from '@solar-icons/react-native/category/time/Linear/ClockCircle';
import { ServerSquare } from '@solar-icons/react-native/category/devices/Linear/ServerSquare';
import { Pen2 as Signature } from '@solar-icons/react-native/category/messages/Linear/Pen2';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';

import { AppText } from '@/components/common/AppText';
import { BottomSheet } from '@/components/common/BottomSheet';
import { InteractionOverlay } from '@/components/common/InteractionOverlay';
import { useLanguageDirection } from '@/i18n/direction';
import { formatClock } from '@/lib/audio/voice';
import { setStringAsync } from '@/lib/clipboard';
import type { Rumor } from '@/db/schema/types';
import { findFileMeta } from '@/lib/nostr/file-tags';
import { formatDetailTimestamp } from '@/lib/time';
import {
  deliveryCounts,
  surfacedRelays,
  useDelivery,
  type MessageDelivery,
  type RelayDelivery,
} from '@/stores/delivery-status.store';
import { iconStrokeWidth } from '@/theme/icons';
import { spacing, uiDensity, useThemeColors } from '@/theme';

type Props = {
  /** Also the visibility key — the sheet is open while this is non-null. */
  rumorId: string | null;
  /** The message's full rumor — powers the time and the raw-JSON block. */
  rumor?: Rumor | null;
  /** Our own message → show delivery status; peer's → show source relays. */
  isSelf: boolean;
  /** Relays this (incoming) message was received from. */
  sourceRelays?: string[] | null;
  /** Persisted delivery (DB) — fallback when there's no live entry (self only). */
  persistedDelivery?: MessageDelivery | null;
  /** The chat transport. Nearby messages never show relay-derived details. */
  transport?: 'relay' | 'proximity';
  /** Resend the message to the relays it failed on (self only). */
  onResend?: (relayUrls: string[]) => void;
  onClose: () => void;
};

/** Strip the scheme + trailing slash so a relay reads as a plain server name. */
function serverName(url: string): string {
  return url.replace(/^wss?:\/\//, '').replace(/\/$/, '');
}

/** Human-readable byte size for the attachment block. */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function StatusIcon({ status }: { status: RelayDelivery['status'] }) {
  const c = useThemeColors();
  if (status === 'ok') return <Check strokeWidth={iconStrokeWidth.default} size={18} color={c.success} />;
  if (status === 'failed')
    return <CircleAlert size={18} color={c.danger} />;
  return <ActivityIndicator size="small" color={c.textMuted} />;
}

function ProximityStatusIcon({ phase }: { phase: MessageDelivery['phase'] }) {
  const c = useThemeColors();
  if (phase === 'sent') return <Check strokeWidth={iconStrokeWidth.default} size={18} color={c.success} />;
  if (phase === 'failed') return <CircleAlert size={18} color={c.danger} />;
  if (phase === 'sending') return <ActivityIndicator size="small" color={c.textMuted} />;
  if (phase === 'signing') return <Signature size={18} color={c.textMuted} />;
  return <Clock size={18} color={c.textMuted} />;
}

function proximityStatusKey(phase: MessageDelivery['phase']): string {
  if (phase === 'queued') return 'nearby.waiting_for_peer';
  if (phase === 'sending') return 'nearby.message_sending';
  if (phase === 'awaiting_ack') return 'nearby.waiting_for_confirmation';
  if (phase === 'sent') return 'nearby.message_sent';
  if (phase === 'failed') return 'nearby.message_failed';
  return 'delivery.signing';
}

function DeliveryStatusRow({
  icon,
  label,
  tone = 'subtle',
}: {
  icon: ReactNode;
  label: string;
  tone?: 'subtle' | 'danger';
}) {
  const direction = useLanguageDirection();
  return (
    <View
      style={{
        direction,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingVertical: spacing.sm,
      }}
    >
      {icon}
      <AppText variant="body" tone={tone}>
        {label}
      </AppText>
    </View>
  );
}

/** A muted overline above a block of detail rows. */
function SectionCaption({ children }: { children: string }) {
  return (
    <AppText variant="caption" tone="subtle" style={{ marginBottom: 6 }}>
      {children}
    </AppText>
  );
}

/**
 * Per-message detail drawer. For our own messages it shows the per-relay
 * delivery breakdown (with a resend for failed relays); for a peer's message it
 * shows which relays we received it from. Both also show the message time and
 * the raw rumor JSON (collapsed by default, with a copy button).
 */
export function MessageDetailSheet({
  rumorId,
  rumor,
  isSelf,
  sourceRelays,
  persistedDelivery,
  transport,
  onResend,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const direction = useLanguageDirection();
  const visible = rumorId != null;

  // Retain the last shown data so the *exit* animation keeps painting the real
  // content. BottomSheet stays mounted while it slides out, but by then the
  // parent has cleared detailRumorId — so without this snapshot the sheet would
  // re-render with null props mid-close and flash the empty "Not recorded"
  // peer state. (Same pattern as MessageActionMenu's dataRef.)
  const snapRef = useRef<{
    rumorId: string;
    rumor: Rumor | null;
    isSelf: boolean;
    sourceRelays: string[] | null;
    persistedDelivery: MessageDelivery | null;
    transport: 'relay' | 'proximity' | null;
  } | null>(null);
  if (visible && rumorId) {
    snapRef.current = {
      rumorId,
      rumor: rumor ?? null,
      isSelf,
      sourceRelays: sourceRelays ?? null,
      persistedDelivery: persistedDelivery ?? null,
      transport: transport ?? null,
    };
  }
  const snap = snapRef.current;

  const liveDelivery = useDelivery(snap?.rumorId ?? '');
  const delivery = liveDelivery ?? snap?.persistedDelivery ?? null;
  const shownIsSelf = snap?.isSelf ?? false;
  const shownRumor = snap?.rumor ?? null;
  const relayList = snap?.sourceRelays ?? [];
  const isProximityDelivery =
    (snap?.transport ?? delivery?.transport) === 'proximity';

  const counts = delivery ? deliveryCounts(delivery) : { ok: 0, total: 0 };
  // The surfaced (recipient, non-self) relays — what "delivered to" shows.
  const rows = delivery ? surfacedRelays(delivery) : [];
  const signing = delivery?.phase === 'signing';
  const failedUrls = rows.filter((r) => r.status === 'failed').map((r) => r.url);

  // Which failed relays have their reason expanded (tap the row to toggle).
  const [openReasons, setOpenReasons] = useState<Set<string>>(new Set());
  const [jsonOpen, setJsonOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // Reset transient UI only when opening a (different) message — not on close,
  // so the retained content stays put during the slide-out.
  useEffect(() => {
    if (rumorId) {
      setOpenReasons(new Set());
      setJsonOpen(false);
      setCopied(false);
    }
  }, [rumorId]);

  function toggleReason(url: string) {
    setOpenReasons((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  // File messages (kind 15): surface the human-meaningful attachment fields.
  // Deliberately NOT the decryption key / hashes (sensitive / jargon).
  const fileMeta =
    shownRumor?.kind === 15 ? findFileMeta(shownRumor.content, shownRumor.tags) : null;
  const attachmentRows = (
    [
      fileMeta?.name ? { label: t('message_detail.file_name'), value: fileMeta.name } : null,
      fileMeta?.mime ? { label: t('message_detail.file_type'), value: fileMeta.mime } : null,
      typeof fileMeta?.size === 'number'
        ? { label: t('message_detail.file_size'), value: formatBytes(fileMeta.size) }
        : null,
      fileMeta?.dim ? { label: t('message_detail.dimensions'), value: fileMeta.dim } : null,
      typeof fileMeta?.durationSec === 'number'
        ? { label: t('message_detail.duration'), value: formatClock(fileMeta.durationSec) }
        : null,
    ] as ({ label: string; value: string } | null)[]
  ).filter((r): r is { label: string; value: string } => r != null);

  const rawJson = shownRumor ? JSON.stringify(shownRumor, null, 2) : '';
  async function copyJson() {
    if (!rawJson) return;
    await setStringAsync(rawJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const sentAt = shownRumor?.created_at ?? null;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t('message_detail.title')}
      contentStyle={{ gap: spacing.lg }}
    >
      {/* Time */}
      {sentAt != null ? (
        <View
          style={{
            direction,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            backgroundColor: c.surfaceMuted,
            borderRadius: 12,
            paddingHorizontal: uiDensity.detailRowHorizontalPadding,
            paddingVertical: uiDensity.detailRowVerticalPadding,
          }}
        >
          <Clock size={18} color={c.textMuted} />
          <AppText variant="body" style={{ flex: 1 }}>
            {t('message_detail.time')}
          </AppText>
          <AppText variant="body" tone="subtle">
            {formatDetailTimestamp(sentAt)}
          </AppText>
        </View>
      ) : null}

      {/* Self: delivery status. */}
      {shownIsSelf ? (
        <View>
          {/* Caption + Resend on one row. minHeight = body lineHeight so the row
              is the same height whether or not Resend is shown. */}
          <View
            style={{
              direction,
              flexDirection: 'row',
              alignItems: 'center',
              minHeight: 22,
              marginBottom: 6,
            }}
          >
            <AppText variant="caption" tone="subtle" style={{ flex: 1 }}>
              {isProximityDelivery
                ? t('delivery.title')
                : signing
                  ? t('delivery.signing')
                  : delivery
                    ? t('delivery.summary', { ok: counts.ok, total: counts.total })
                    : t('message_detail.delivered_to')}
            </AppText>
            {onResend && failedUrls.length > 0 ? (
              <Pressable
                onPress={() => onResend(failedUrls)}
                hitSlop={8}
                style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
              >
                <AppText variant="body" weight="semibold" style={{ color: c.accent }}>
                  {t('delivery.resend')}
                </AppText>
              </Pressable>
            ) : null}
          </View>
          {isProximityDelivery ? (
            <DeliveryStatusRow
              icon={
                delivery ? (
                  <ProximityStatusIcon phase={delivery.phase} />
                ) : (
                  <Clock size={18} color={c.textMuted} />
                )
              }
              label={
                delivery
                  ? t(proximityStatusKey(delivery.phase))
                  : t('message_detail.delivery_unknown')
              }
              tone={delivery?.phase === 'failed' ? 'danger' : 'subtle'}
            />
          ) : signing ? (
            <DeliveryStatusRow
              icon={<Signature size={18} color={c.textMuted} />}
              label={t('delivery.signing')}
            />
          ) : rows.length > 0 ? (
            <View
              style={{ backgroundColor: c.surfaceMuted, borderRadius: 12, overflow: 'hidden' }}
            >
              {rows.map((r, i) => {
                const isFailed = r.status === 'failed';
                const open = openReasons.has(r.url);
                const row = (
                  <View
                    style={{
                      paddingHorizontal: uiDensity.detailRowHorizontalPadding,
                      paddingVertical: uiDensity.detailRowVerticalPadding,
                      borderTopWidth: i === 0 ? 0 : 1,
                      borderTopColor: c.border,
                    }}
                  >
                    <View
                      style={{
                        direction,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 12,
                      }}
                    >
                      <ServerSquare size={18} color={c.textMuted} />
                      <AppText variant="body" numberOfLines={1} style={{ flex: 1 }}>
                        {serverName(r.url)}
                      </AppText>
                      <StatusIcon status={r.status} />
                    </View>
                    {isFailed && open ? (
                      <AppText variant="caption" style={{ color: c.danger, marginTop: 4 }}>
                        {r.error || t('delivery.failed')}
                      </AppText>
                    ) : null}
                  </View>
                );
                return isFailed ? (
                  <Pressable
                    key={`${r.url}:${i}`}
                    onPress={() => toggleReason(r.url)}
                    fallbackHoverOpacity={false}
                  >
                    {({ pressed }) => (
                      <>
                        {pressed ? <InteractionOverlay /> : null}
                        {row}
                      </>
                    )}
                  </Pressable>
                ) : (
                  <View key={`${r.url}:${i}`}>{row}</View>
                );
              })}
            </View>
          ) : !delivery ? (
            // No local delivery record (e.g. imported history, or a message
            // sent before delivery was tracked) — say so plainly instead of a
            // misleading "0 of 0".
            <View
              style={{
                backgroundColor: c.surfaceMuted,
                borderRadius: 12,
                paddingHorizontal: uiDensity.detailRowHorizontalPadding,
                paddingVertical: uiDensity.detailRowVerticalPadding,
              }}
            >
              <AppText variant="body" tone="subtle">
                {t('message_detail.delivery_unknown')}
              </AppText>
            </View>
          ) : null}
        </View>
      ) : isProximityDelivery ? null : (
        /* Peer: which relays we received this message from. */
        <View>
          <SectionCaption>{t('message_detail.received_from')}</SectionCaption>
          {relayList.length > 0 ? (
            <View
              style={{ backgroundColor: c.surfaceMuted, borderRadius: 12, overflow: 'hidden' }}
            >
              {relayList.map((url, i) => (
                <View
                  key={`${url}:${i}`}
                  style={{
                    direction,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    paddingHorizontal: uiDensity.detailRowHorizontalPadding,
                    paddingVertical: uiDensity.detailRowVerticalPadding,
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: c.border,
                  }}
                >
                  <ServerSquare size={18} color={c.textMuted} />
                  <AppText variant="body" numberOfLines={1} style={{ flex: 1 }}>
                    {serverName(url)}
                  </AppText>
                </View>
              ))}
            </View>
          ) : (
            <View
              style={{
                backgroundColor: c.surfaceMuted,
                borderRadius: 12,
                paddingHorizontal: uiDensity.detailRowHorizontalPadding,
                paddingVertical: uiDensity.detailRowVerticalPadding,
              }}
            >
              <AppText variant="body" tone="subtle">
                {t('message_detail.received_from_unknown')}
              </AppText>
            </View>
          )}
        </View>
      )}

      {/* Attachment details (file messages only). */}
      {attachmentRows.length > 0 ? (
        <View>
          <SectionCaption>{t('message_detail.attachment')}</SectionCaption>
          <View
            style={{ backgroundColor: c.surfaceMuted, borderRadius: 12, overflow: 'hidden' }}
          >
            {attachmentRows.map((r, i) => (
              <View
                key={r.label}
                style={{
                  direction,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingHorizontal: uiDensity.detailRowHorizontalPadding,
                  paddingVertical: uiDensity.detailRowVerticalPadding,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: c.border,
                }}
              >
                <AppText variant="body" tone="subtle">
                  {r.label}
                </AppText>
                <AppText variant="body" numberOfLines={1} style={{ flex: 1 }} align="end">
                  {r.value}
                </AppText>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {/* Raw rumor JSON — collapsed by default. */}
      {rawJson ? (
        <View>
          <Pressable
            onPress={() => setJsonOpen((v) => !v)}
            fallbackHoverOpacity={false}
            style={{
              direction,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              backgroundColor: c.surfaceMuted,
              borderTopLeftRadius: 12,
              borderTopRightRadius: 12,
              borderBottomLeftRadius: jsonOpen ? 0 : 12,
              borderBottomRightRadius: jsonOpen ? 0 : 12,
              overflow: 'hidden',
              paddingHorizontal: uiDensity.detailRowHorizontalPadding,
              paddingVertical: uiDensity.detailRowVerticalPadding,
            }}
          >
            {({ pressed }) => (
              <>
                {pressed ? <InteractionOverlay /> : null}
                <AppText variant="body" style={{ flex: 1 }}>
                  {t('message_detail.raw_json')}
                </AppText>
                {jsonOpen ? (
                  <Pressable
                    onPress={copyJson}
                    hitSlop={10}
                    style={({ pressed: copyPressed }) => ({ opacity: copyPressed ? 0.5 : 1 })}
                  >
                    {copied ? (
                      <Check strokeWidth={iconStrokeWidth.default} size={18} color={c.success} />
                    ) : (
                      <Copy size={18} color={c.textMuted} />
                    )}
                  </Pressable>
                ) : null}
                {/* Swap the glyph instead of rotating it, so "collapse" reads
                    clearly when open. Tapping the header row toggles it. */}
                {jsonOpen ? (
                  <ChevronUp strokeWidth={iconStrokeWidth.default} size={18} color={c.textMuted} />
                ) : (
                  <ChevronDown strokeWidth={iconStrokeWidth.default} size={18} color={c.textMuted} />
                )}
              </>
            )}
          </Pressable>
          {jsonOpen ? (
            // No inner ScrollView — the whole sheet scrolls now (BottomSheet),
            // and nesting a second vertical scroll would conflict. The JSON
            // flows full-length and the sheet caps + scrolls it.
            <View
              style={{
                direction: 'ltr',
                backgroundColor: c.surfaceMuted,
                borderBottomLeftRadius: 12,
                borderBottomRightRadius: 12,
                paddingHorizontal: uiDensity.detailRowHorizontalPadding,
                paddingBottom: 14,
              }}
            >
              <AppText
                variant="code"
                tone="muted"
                align={direction === 'rtl' ? 'end' : 'start'}
                style={{ direction: 'ltr' }}
              >
                {rawJson}
              </AppText>
            </View>
          ) : null}
        </View>
      ) : null}
    </BottomSheet>
  );
}
