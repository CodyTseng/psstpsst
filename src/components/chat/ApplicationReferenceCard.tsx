import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AppButton } from '@/components/common/AppButton';
import { ApplicationIcon } from '@/components/napplet/ApplicationIcon';
import { useApplicationReference } from '@/hooks/use-application-reference';
import type { NostrEventReference } from '@/lib/nostr/event-reference';
import { MessageCard } from './MessageCard';
import { MessageCardHeader, MessageCardText, MESSAGE_CARD_VISUAL_SIZE } from './MessageCardHeader';
import { MessageCardSource } from './MessageCardSource';

const EMPTY_ICON = { servers: [] };

/** All signed application formats share one metadata card and open their review page. */
export function ApplicationReferenceCard({ reference, metaSlot, loadRemote = true }: {
  reference: NostrEventReference; metaSlot?: ReactNode; loadRemote?: boolean;
}) {
  const { t } = useTranslation();
  const { entry, loading, retry } = useApplicationReference(reference, loadRemote);
  return <MessageCard type="application" disabled={!loadRemote} metaSlot={metaSlot}
    accessibilityLabel={`${entry?.title ?? t('applications.app_title')}: ${t('applications.details')}`}
    onPress={() => router.push({ pathname: '/explore-details', params: { address: reference.bech32 } })}
    footer={!entry && !loading ?
      <AppButton variant="text" compact labelVariant="caption" labelNumberOfLines={1} label={t('common.retry')} disabled={!loadRemote}
        onPress={event => { event.stopPropagation(); retry(); }} /> : undefined}
    header={<MessageCardHeader title={entry?.title ?? t('applications.app_title')}
      subtitle={<MessageCardSource pubkey={entry?.manifest?.pubkey ?? reference.author} loadRemote={loadRemote} />}
      visual={<ApplicationIcon release={entry ?? EMPTY_ICON} size={MESSAGE_CARD_VISUAL_SIZE} loadRemote={loadRemote && !!entry} />}
    />}>
    <MessageCardText variant="body" lines={2}>{entry ? entry.description.slice(0, 800) : t(loading ? 'chat.event_reference.loading' : 'chat.event_reference.unavailable')}</MessageCardText>
  </MessageCard>;
}
