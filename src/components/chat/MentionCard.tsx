import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/common/Avatar';
import { useDisplayName } from '@/hooks/use-display-name';
import { abbreviateNpub } from '@/lib/nostr/format';
import { pubkeyToNpub } from '@/lib/nostr/keys';
import { MessageCard } from './MessageCard';
import { MessageCardHeader, MESSAGE_CARD_VISUAL_SIZE } from './MessageCardHeader';

type Props = {
  pubkey: string;
  metaSlot?: ReactNode;
  /** Sharing previews retain the same geometry without profile navigation. */
  interactive?: boolean;
  loadRemote?: boolean;
};

/** A profile reference shares the rich-message frame and identity hierarchy. */
export function MentionCard({ pubkey, metaSlot, interactive = true, loadRemote = true }: Props) {
  const { t } = useTranslation();
  const { name, profile } = useDisplayName(pubkey, loadRemote);
  const secondary = profile?.nip05 ?? abbreviateNpub(pubkeyToNpub(pubkey));
  return <MessageCard type="profile" metaSlot={metaSlot} disabled={!loadRemote}
    accessibilityLabel={`${name}: ${t('chat.view_profile')}`}
    onPress={interactive ? () => router.push(`/profile/${encodeURIComponent(pubkey)}`) : undefined}
    header={<MessageCardHeader title={name}
      visual={<Avatar pubkey={pubkey} picture={loadRemote ? profile?.picture : undefined} size={MESSAGE_CARD_VISUAL_SIZE} />}
      subtitle={secondary} />} />;
}
