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
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';

import { AppText } from '@/components/common/AppText';
import { AppButton } from '@/components/common/AppButton';
import { Avatar } from '@/components/common/Avatar';
import { BottomSheet } from '@/components/common/BottomSheet';
import { HorizontalFadeScrollView } from '@/components/common/HorizontalFadeScrollView';
import { InteractionOverlay } from '@/components/common/InteractionOverlay';
import { useMessageDelivery } from '@/hooks/use-message-deliveries';
import { useLanguageDirection } from '@/i18n/direction';
import { formatClock } from '@/lib/audio/voice';
import { setStringAsync } from '@/lib/clipboard';
import type { Rumor } from '@/db/schema/types';
import { findFileMeta } from '@/lib/nostr/file-tags';
import { formatDetailTimestamp } from '@/lib/time';
import {
  deliveryCopyVerdict,
  deliveryCounts,
  retryableRelayUrls,
  useDelivery,
  type DeliveryCopy,
  type MessageDelivery,
  type RelayDelivery,
} from '@/stores/delivery-status.store';
import { iconStrokeWidth } from '@/theme/icons';
import { radius, spacing, typography, uiDensity, useThemeColors } from '@/theme';
import { useProfile } from '@/hooks/use-profile';
import { useContact } from '@/hooks/use-contacts';
import { resolveDisplayName } from '@/lib/nostr/display-name';

type Props = {
  accountPubkey: string;
  /** Also the visibility key — the sheet is open while this is non-null. */
  rumorId: string | null;
  /** The message's full rumor — powers the time and the raw-JSON block. */
  rumor?: Rumor | null;
  /** Our own message → show delivery status; peer's → show source relays. */
  isSelf: boolean;
  /** Relays this (incoming) message was received from. */
  sourceRelays?: string[] | null;
  /** The chat transport. Nearby messages never show relay-derived details. */
  transport?: 'relay' | 'proximity';
  /** Retry every failed recipient relay copy (self only). */
  onRetryAll?: () => void;
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

function StatusIcon({
  status,
  size = 18,
  staticPending = false,
}: {
  status: RelayDelivery['status'];
  size?: number;
  staticPending?: boolean;
}) {
  const c = useThemeColors();
  if (status === 'ok') return <Check strokeWidth={iconStrokeWidth.default} size={size} color={c.success} />;
  if (status === 'failed')
    return <CircleAlert size={size} color={c.danger} />;
  if (staticPending) return <Clock size={size} color={c.textMuted} />;
  return <ActivityIndicator size="small" color={c.textMuted} />;
}

function useDeliveryCopyIdentity(accountPubkey: string, copy: DeliveryCopy) {
  const { t } = useTranslation();
  const profile = useProfile(copy.recipient);
  const contact = useContact(accountPubkey, copy.recipient);
  const name = copy.recipient === accountPubkey
    ? t('delivery.self')
    : resolveDisplayName(copy.recipient, {
        petname: contact?.petname,
        displayName: profile?.displayName,
        name: profile?.name,
      });
  return { name, picture: profile?.picture };
}

export function orderDeliveryCopies(
  copies: DeliveryCopy[],
  accountPubkey: string,
): DeliveryCopy[] {
  let selfSeen = false;
  let needsReorder = false;
  for (const copy of copies) {
    if (copy.recipient === accountPubkey) selfSeen = true;
    else if (selfSeen) {
      needsReorder = true;
      break;
    }
  }
  if (!needsReorder) return copies;

  const recipients: DeliveryCopy[] = [];
  const selfCopies: DeliveryCopy[] = [];
  for (const copy of copies) {
    (copy.recipient === accountPubkey ? selfCopies : recipients).push(copy);
  }
  return recipients.concat(selfCopies);
}

export function DeliveryCopyTab({
  accountPubkey,
  copy,
  selected,
  onSelect,
}: {
  accountPubkey: string;
  copy: DeliveryCopy;
  selected: boolean;
  onSelect: () => void;
}) {
  const c = useThemeColors();
  const { name, picture } = useDeliveryCopyIdentity(accountPubkey, copy);
  const verdict = deliveryCopyVerdict(copy);
  const status = verdict === 'delivered' ? 'ok' : verdict === 'pending' ? 'pending' : 'failed';
  const badgeSize = uiDensity.countBadge.sm.size;
  const avatarSize = uiDensity.contactAvatarSize;
  const tabSize = avatarSize + spacing.sm * 2;
  return (
    <View
      style={{
        width: tabSize,
        height: tabSize,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <AppButton
        accessibilityRole="tab"
        accessibilityLabel={name}
        accessibilityState={{ selected }}
        variant="ghost"
        corner="lg"
        compact
        compactInset={spacing.sm}
        fullWidth
        selected={selected}
        iconLeft={
          <View>
            <Avatar
              pubkey={copy.recipient}
              picture={picture}
              name={name}
              size={avatarSize}
            />
          </View>
        }
        onPress={onSelect}
      />
      <View
        style={{
          position: 'absolute',
          end: uiDensity.messageDeliveryStatusInset,
          bottom: uiDensity.messageDeliveryStatusInset,
          width: badgeSize,
          height: badgeSize,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: radius.full,
          backgroundColor: c.background,
          pointerEvents: 'none',
        }}
      >
        <StatusIcon
          status={status}
          size={badgeSize - spacing.xs}
          staticPending
        />
      </View>
    </View>
  );
}

export function DeliveryCopyTabs({
  accountPubkey,
  copies,
  selectedRecipient,
  onSelect,
}: {
  accountPubkey: string;
  copies: DeliveryCopy[];
  selectedRecipient: string | undefined;
  onSelect: (recipient: string) => void;
}) {
  const c = useThemeColors();
  const orderedCopies = orderDeliveryCopies(copies, accountPubkey);

  return (
    <HorizontalFadeScrollView
      fadeColor={c.sheetBackground}
      containerStyle={{
        marginHorizontal: -spacing.lg,
      }}
      accessibilityRole="tablist"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{
        alignItems: 'center',
        gap: spacing.sm,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.xs,
      }}
    >
      {orderedCopies.map((copy) => (
        <DeliveryCopyTab
          key={copy.recipient}
          accountPubkey={accountPubkey}
          copy={copy}
          selected={copy.recipient === selectedRecipient}
          onSelect={() => onSelect(copy.recipient)}
        />
      ))}
    </HorizontalFadeScrollView>
  );
}

export function DeliveryCopyDetail({
  accountPubkey,
  copy,
}: {
  accountPubkey: string;
  copy: DeliveryCopy;
}) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const direction = useLanguageDirection();
  const { name } = useDeliveryCopyIdentity(accountPubkey, copy);
  const [openReasons, setOpenReasons] = useState<Set<string>>(new Set());

  function toggleReason(url: string) {
    setOpenReasons((previous) => {
      const next = new Set(previous);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  return (
    <View style={{ gap: spacing.md }}>
      <View
        style={{
          direction,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
        }}
      >
        <AppText variant="subtitle" numberOfLines={1} style={{ flex: 1 }}>
          {name}
        </AppText>
      </View>
      {copy.error ? (
        <AppText variant="caption" tone="danger">{copy.error}</AppText>
      ) : null}
      {copy.relays.length > 0 ? (
        <View
          style={{
            backgroundColor: c.surfaceMuted,
            borderRadius: radius.lg,
            overflow: 'hidden',
          }}
        >
          {copy.relays.map((relay, index) => {
            const failedRelay = relay.status === 'failed';
            const reasonOpen = openReasons.has(relay.url);
            const row = (
              <View
                style={{
                  paddingHorizontal: uiDensity.detailRowHorizontalPadding,
                  paddingVertical: uiDensity.detailRowVerticalPadding,
                  borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                  borderTopColor: c.border,
                }}
              >
                <View
                  style={{
                    direction,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.md,
                  }}
                >
                  <ServerSquare size={18} color={c.textMuted} />
                  <AppText variant="body" numberOfLines={1} style={{ flex: 1 }}>
                    {serverName(relay.url)}
                  </AppText>
                  <StatusIcon status={relay.status} />
                </View>
                {failedRelay && reasonOpen ? (
                  <AppText
                    variant="caption"
                    tone="danger"
                    style={{ marginTop: spacing.xs }}
                  >
                    {relay.error || t('delivery.failed')}
                  </AppText>
                ) : null}
              </View>
            );
            return failedRelay ? (
              <Pressable
                key={relay.url}
                accessibilityRole="button"
                accessibilityLabel={serverName(relay.url)}
                accessibilityState={{ expanded: reasonOpen }}
                fallbackHoverOpacity={false}
                onPress={() => toggleReason(relay.url)}
              >
                {({ pressed }) => (
                  <>
                    {pressed ? <InteractionOverlay /> : null}
                    {row}
                  </>
                )}
              </Pressable>
            ) : (
              <View key={relay.url}>{row}</View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
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

export function DeliverySummaryRow({
  label,
  onRetry,
}: {
  label: string;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  const direction = useLanguageDirection();
  return (
    <View
      style={{
        direction,
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: typography.body.lineHeight,
      }}
    >
      <AppText variant="caption" tone="subtle" numberOfLines={1} style={{ flex: 1 }}>
        {label}
      </AppText>
      {onRetry ? (
        <AppButton
          label={t('delivery.resend')}
          labelNumberOfLines={1}
          variant="accentText"
          fullWidth={false}
          onPress={onRetry}
        />
      ) : null}
    </View>
  );
}

/**
 * Per-message detail drawer. For our own messages it shows the per-relay
 * delivery breakdown (with a resend for failed relays); for a peer's message it
 * shows which relays we received it from. Both also show the message time and
 * the raw rumor JSON (collapsed by default, with a copy button).
 */
export function MessageDetailSheet({
  accountPubkey,
  rumorId,
  rumor,
  isSelf,
  sourceRelays,
  transport,
  onRetryAll,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const direction = useLanguageDirection();
  const visible = rumorId != null;
  const persistedDelivery = useMessageDelivery(accountPubkey, rumorId, visible && isSelf);

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
  const delivery =
    snap?.transport === 'proximity'
      ? liveDelivery ?? snap.persistedDelivery ?? null
      : snap?.persistedDelivery ?? null;
  const shownIsSelf = snap?.isSelf ?? false;
  const shownRumor = snap?.rumor ?? null;
  const relayList = snap?.sourceRelays ?? [];
  const isProximityDelivery =
    (snap?.transport ?? delivery?.transport) === 'proximity';

  const counts = delivery ? deliveryCounts(delivery) : { ok: 0, total: 0 };
  const retryUrls = delivery ? retryableRelayUrls(delivery) : null;
  const signing =
    delivery?.phase === 'signing' ||
    (delivery?.phase === 'queued' && delivery.copies.length === 0);
  const failed = delivery?.phase === 'failed';
  const [jsonOpen, setJsonOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [deliverySelection, setDeliverySelection] = useState<{
    rumorId: string;
    recipient: string;
  } | null>(null);
  const deliveryCopies = orderDeliveryCopies(delivery?.copies ?? [], accountPubkey);
  const selectedByUser =
    deliverySelection && deliverySelection.rumorId === snap?.rumorId
      ? deliverySelection.recipient
      : undefined;
  const selectedRecipient =
    selectedByUser &&
    deliveryCopies.some((copy) => copy.recipient === selectedByUser)
      ? selectedByUser
      : deliveryCopies[0]?.recipient;
  const selectedCopy = deliveryCopies.find(
    (copy) => copy.recipient === selectedRecipient,
  );
  // Reset transient UI only when opening a (different) message — not on close,
  // so the retained content stays put during the slide-out.
  useEffect(() => {
    if (rumorId) {
      setJsonOpen(false);
      setCopied(false);
    }
  }, [rumorId]);

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
          <View style={{ marginBottom: spacing.xs }}>
            <DeliverySummaryRow
              label={
                isProximityDelivery
                  ? t('delivery.title')
                  : signing
                    ? t('delivery.signing')
                    : delivery
                      ? t('delivery.summary', { ok: counts.ok, total: counts.total })
                      : t('message_detail.delivered_to')
              }
              onRetry={
                !isProximityDelivery && retryUrls !== null && onRetryAll
                  ? onRetryAll
                  : undefined
              }
            />
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
          ) : delivery && delivery.copies.length > 0 ? (
            <View style={{ gap: spacing.xs }}>
              <DeliveryCopyTabs
                accountPubkey={accountPubkey}
                copies={deliveryCopies}
                selectedRecipient={selectedRecipient}
                onSelect={(recipient) => {
                  if (!snap?.rumorId) return;
                  setDeliverySelection({
                    rumorId: snap.rumorId,
                    recipient,
                  });
                }}
              />
              {selectedCopy ? (
                <DeliveryCopyDetail
                  key={selectedCopy.recipient}
                  accountPubkey={accountPubkey}
                  copy={selectedCopy}
                />
              ) : null}
            </View>
          ) : failed ? (
            <View style={{ gap: spacing.sm }}>
              <DeliveryStatusRow
                icon={<CircleAlert size={18} color={c.danger} />}
                label={delivery?.error || t('delivery.failed')}
                tone="danger"
              />
              {onRetryAll ? (
                <AppButton
                  label={t('delivery.resend')}
                  variant="accentText"
                  size="sm"
                  fullWidth={false}
                  onPress={onRetryAll}
                />
              ) : null}
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
