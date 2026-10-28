import type { Event } from 'nostr-tools';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/common/AppText';
import { Avatar } from '@/components/common/Avatar';
import { EmojiPackReferenceCard } from '@/components/emoji/EmojiPackReferenceCard';
import { useDisplayName } from '@/hooks/use-display-name';
import { useReferencedEvent } from '@/hooks/use-referenced-event';
import { KIND_EMOJI_SET } from '@/lib/nostr/custom-emoji';
import type { NostrEventReference } from '@/lib/nostr/event-reference';
import { nostrEventUrl } from '@/lib/nostr/event-url';
import { formatListTime } from '@/lib/time';
import { canResolveReferencedEvent } from '@/services/nostr/event-reference.service';
import { isApplicationReference } from '@/services/explore/application-reference';
import { useChatPrefsStore } from '@/stores/chat-prefs.store';

import { MessageCard } from './MessageCard';
import { MessageCardHeader, MessageCardText, MESSAGE_CARD_VISUAL_SIZE } from './MessageCardHeader';
import { ApplicationReferenceCard } from './ApplicationReferenceCard';
import { MentionCard } from './MentionCard';
import { openMessageUrl } from './open-message-url';
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

  return <MessageCardText variant="body" lines={4}>{event.content ? boundedText(event.content) : t('chat.event_reference.empty')}</MessageCardText>;
}

function ResolvedHeader({ event, loadRemote }: { event: Event; loadRemote: boolean }) {
  const { name, profile } = useDisplayName(event.pubkey, loadRemote);
  return <MessageCardHeader title={name}
    visual={<Avatar pubkey={event.pubkey} picture={loadRemote ? profile?.picture : undefined} size={MESSAGE_CARD_VISUAL_SIZE} />}
    subtitle={formatListTime(event.created_at)} />;
}

/** A compact neutral card for a public-event reference block. Kind 1 gets a
 * bounded preview, kind 0 reuses MentionCard, and unsupported pointers remain
 * useful links with their kind number visible. */
function DefaultEventReferenceCard({ reference, metaSlot, loadRemote = true }: Props) {
  const { t } = useTranslation();
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
  const note = event ? event.kind === 1 : reference.kind === 1 || reference.kind == null;
  const status = t(loading ? 'chat.event_reference.loading' : 'chat.event_reference.unavailable');

  return <MessageCard type={note ? 'note' : reference.kind === 0 ? 'profile' : 'event'} disabled={!loadRemote} accessibilityLabel={t('napplets.open')}
    onPress={() => { void openMessageUrl(href); }} metaSlot={metaSlot}
    header={event ? <ResolvedHeader event={event} loadRemote={loadRemote} /> :
      <MessageCardHeader title={note ? t('chat.card_types.note') : fallbackLabel} reserveVisual={note || reference.kind === 0}
        subtitle={!note && resolvable ? status : ''} />}>
    {event ? <EventContent event={event} /> : note ? <MessageCardText variant="body" lines={4}>{status}</MessageCardText> : null}
  </MessageCard>;
}

export function EventReferenceCard({ reference, metaSlot, loadRemote = true, downloadMode = 'auto' }: Props) {
  if (isApplicationReference(reference)) {
    return <ApplicationReferenceCard reference={reference} metaSlot={metaSlot} loadRemote={loadRemote} />;
  }
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
