import { and, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { contacts, conversations, profiles } from '@/db/schema';
import type { Rumor } from '@/db/schema/types';
import i18n from '@/i18n';
import { resolveName } from '@/lib/nostr/display-name';
import { attachmentLabel } from '@/lib/nostr/attachment-label';

const KIND_FILE = 15;

export type NotificationPreview = {
  displayName: string | null;
  messageContent: string | null;
  avatarUrl: string | null;
};

/**
 * Resolve only the latest aggregate member at delivery time. The single joined
 * lookup keeps preview work constant regardless of conversation history size.
 */
export async function getNotificationPreview(
  rumor: Rumor,
  accountPubkey: string,
  options: { includeIdentity: boolean } = { includeIdentity: true },
): Promise<NotificationPreview> {
  const [row] = options.includeIdentity
    ? await db
        .select({
          petname: contacts.petname,
          profileDisplayName: profiles.displayName,
          profileName: profiles.name,
          picture: profiles.picture,
        })
        .from(conversations)
        .leftJoin(
          contacts,
          and(
            eq(contacts.accountPubkey, conversations.accountPubkey),
            eq(contacts.pubkey, conversations.conversationKey),
          ),
        )
        .leftJoin(profiles, eq(profiles.pubkey, conversations.conversationKey))
        .where(
          and(
            eq(conversations.accountPubkey, accountPubkey),
            eq(conversations.conversationKey, rumor.pubkey),
          ),
        )
        .limit(1)
    : [];

  const displayName = resolveName({
    petname: row?.petname,
    displayName: row?.profileDisplayName,
    name: row?.profileName,
  });
  const messageContent =
    rumor.kind === KIND_FILE
      ? attachmentLabel(rumor.tags, {
          file: i18n.t('conversations.attachment_file_preview'),
          image: i18n.t('conversations.attachment_image_preview'),
          video: i18n.t('conversations.attachment_video_preview'),
          voice: i18n.t('conversations.attachment_voice_preview'),
        })
      : rumor.content.trim() || null;

  return {
    displayName,
    messageContent,
    avatarUrl: row?.picture ?? null,
  };
}
