import { SquareArrowRightUp as ExternalLink } from '@solar-icons/react-native/category/arrows/Linear/SquareArrowRightUp';
import type { Event } from 'nostr-tools';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';

import { AppText } from '@/components/common/AppText';
import { Avatar } from '@/components/common/Avatar';
import { InteractionOverlay } from '@/components/common/InteractionOverlay';
import { EmojiPackReferenceCard } from '@/components/emoji/EmojiPackReferenceCard';
import { useDisplayName } from '@/hooks/use-display-name';
import { useReferencedEvent } from '@/hooks/use-referenced-event';
import { useDirectionalIconStyle } from '@/i18n/direction';
import { KIND_EMOJI_SET } from '@/lib/nostr/custom-emoji';
import type { NostrEventReference } from '@/lib/nostr/event-reference';
import { nostrEventUrl } from '@/lib/nostr/event-url';
import { formatListTime } from '@/lib/time';
import { canResolveReferencedEvent } from '@/services/nostr/event-reference.service';
import { platform } from '@/platform';
import { useChatPrefsStore } from '@/stores/chat-prefs.store';
import { radius, spacing, useThemeColors } from '@/theme';

import { MessageCardFooter } from './MessageCardFooter';
import { MentionCard } from './MentionCard';
import type { RemoteContentMode } from './remote-content-policy';

type Props = {
  reference: NostrEventReference;
  /** Message time + delivery glyph, aligned at the card footer's end. */
  metaSlot?: ReactNode;
  loadRemote?: boolean;
  /** Download policy applies to referenced media, never to relay metadata. */
  downloadMode?: RemoteContentMode;
};

const BODY_PREVIEW_CHARS = 800;

function boundedText(value: string, limit = BODY_PREVIEW_CHARS): string {
  if (value.length <= limit) return value;
  let end = limit;
  const lastCode = value.charCodeAt(end - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) end -= 1;
  return `${value.slice(0, end)}…`;
}

function EventContent({ event }: { event: Event }) {
  const { t } = useTranslation();
  if (event.kind !== 1) {
    return (
      <AppText variant="caption" tone="muted">
        {t('chat.event_reference.kind', { kind: event.kind })}
      </AppText>
    );
  }

  return event.content ? (
    <AppText variant="body" numberOfLines={4}>
      {boundedText(event.content)}
    </AppText>
  ) : (
    <AppText variant="caption" tone="muted">
      {t('chat.event_reference.empty')}
    </AppText>
  );
}

function ResolvedHeader({ event, loadRemote }: { event: Event; loadRemote: boolean }) {
  const { name, profile } = useDisplayName(event.pubkey, loadRemote);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <Avatar
        pubkey={event.pubkey}
        picture={loadRemote ? profile?.picture : undefined}
        size={36}
      />
      <View style={{ flex: 1, minWidth: 0 }}>
        <AppText variant="caption" weight="semibold" numberOfLines={1}>
          {name}
        </AppText>
        <AppText variant="caption" tone="muted" numberOfLines={1}>
          {formatListTime(event.created_at)}
        </AppText>
      </View>
    </View>
  );
}

/** A compact neutral card for a public-event reference block. Kind 1 gets a
 * bounded preview, kind 0 reuses MentionCard, and unsupported pointers remain
 * useful external links with their kind number visible. */
function DefaultEventReferenceCard({ reference, metaSlot, loadRemote = true }: Props) {
  const { t } = useTranslation();
  const directionalIconStyle = useDirectionalIconStyle();
  const c = useThemeColors();
  const { event, loading } = useReferencedEvent(reference, loadRemote);
  const resolvable = canResolveReferencedEvent(reference);
  const urlTemplate = useChatPrefsStore((s) => s.nostrEventUrl);
  const href = nostrEventUrl(reference, urlTemplate);
  const fallbackLabel =
    reference.kind == null
      ? t('chat.event_reference.event')
      : t('chat.event_reference.kind', { kind: reference.kind });

  if (event?.kind === 0) {
    return <MentionCard loadRemote={loadRemote} pubkey={event.pubkey} metaSlot={metaSlot} />;
  }

  return (
    <Pressable
      disabled={!loadRemote}
      accessibilityRole="link"
      accessibilityLabel={t('chat.event_reference.open_external')}
      fallbackHoverOpacity={false}
      onPress={() => void platform.urlOpener.openExternalUrl(href).catch(() => {})}
      style={{
        width: 280,
        maxWidth: '100%',
        paddingTop: 10,
        paddingHorizontal: 10,
        paddingBottom: 6,
        borderRadius: radius.lg,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.border,
        backgroundColor: c.surface,
      }}
    >
      {({ pressed }) => (
        <>
          {pressed ? <InteractionOverlay borderRadius={radius.lg} /> : null}
          <View style={{ gap: spacing.md }}>
            {event ? (
              <ResolvedHeader event={event} loadRemote={loadRemote} />
            ) : (
              <View style={{ gap: spacing.xs }}>
                <AppText variant="caption" weight="semibold">
                  {fallbackLabel}
                </AppText>
                {resolvable ? (
                  <AppText variant="caption" tone="muted">
                    {loading
                      ? t('chat.event_reference.loading')
                      : t('chat.event_reference.unavailable')}
                  </AppText>
                ) : null}
              </View>
            )}

            {event ? <EventContent event={event} /> : null}
          </View>
          <MessageCardFooter
            leading={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                <ExternalLink size={14} color={c.accent} style={directionalIconStyle} />
                <AppText variant="caption" tone="accent" numberOfLines={1}>
                  {t('chat.event_reference.open_external')}
                </AppText>
              </View>
            }
            metaSlot={metaSlot}
          />
        </>
      )}
    </Pressable>
  );
}

export function EventReferenceCard({ reference, metaSlot, loadRemote = true, downloadMode = 'auto' }: Props) {
  if (
    reference.kind === KIND_EMOJI_SET &&
    reference.author &&
    reference.identifier
  ) {
    return (
      <EmojiPackReferenceCard
        downloadMode={downloadMode}
        loadRemote={loadRemote}
        authorPubkey={reference.author}
        identifier={reference.identifier}
        metaSlot={metaSlot}
      />
    );
  }
  return <DefaultEventReferenceCard loadRemote={loadRemote} reference={reference} metaSlot={metaSlot} />;
}
