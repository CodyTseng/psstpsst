import { and, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { contacts, conversations, profiles } from '@/db/schema';
import type { Rumor } from '@/db/schema/types';
import i18n from '@/i18n';
import { resolveDisplayName, resolveName } from '@/lib/nostr/display-name';
import { attachmentLabel } from '@/lib/nostr/attachment-label';
import {
  firstGroupId,
  groupConversationKey,
  parseGroupAction,
} from '@/lib/nostr/group-messaging';

const KIND_FILE = 15;

export type NotificationPreview = {
  displayName: string | null;
  messageContent: string | null;
  avatarUrl: string | null;
  senderName?: string | null;
  group?: boolean;
};

async function resolveIdentity(accountPubkey: string, pubkey: string) {
  const [[contact], [profile]] = await Promise.all([
    db
      .select({ petname: contacts.petname })
      .from(contacts)
      .where(and(eq(contacts.accountPubkey, accountPubkey), eq(contacts.pubkey, pubkey)))
      .limit(1),
    db
      .select({
        profileDisplayName: profiles.displayName,
        profileName: profiles.name,
        picture: profiles.picture,
      })
      .from(profiles)
      .where(eq(profiles.pubkey, pubkey))
      .limit(1),
  ]);
  return {
    name: resolveDisplayName(pubkey, {
      petname: contact?.petname,
      displayName: profile?.profileDisplayName,
      name: profile?.profileName,
    }),
    picture: profile?.picture ?? null,
  };
}

/**
 * Resolve only the latest aggregate member at delivery time. The single joined
 * lookup keeps preview work constant regardless of conversation history size.
 */
export async function getNotificationPreview(
  rumor: Rumor,
  accountPubkey: string,
  options: { includeIdentity: boolean } = { includeIdentity: true },
): Promise<NotificationPreview> {
  const groupId = firstGroupId(rumor.tags);
  if (groupId) {
    const action = parseGroupAction(rumor.tags);
    let groupName: string | null = null;
    let senderName: string | null = null;
    let avatarUrl: string | null = null;
    if (options.includeIdentity) {
      const [conversation] = await db
        .select({ name: conversations.name, memberPubkeys: conversations.memberPubkeys })
        .from(conversations)
        .where(
          and(
            eq(conversations.accountPubkey, accountPubkey),
            eq(conversations.conversationKey, groupConversationKey(groupId)),
          ),
        )
        .limit(1);
      const sender = await resolveIdentity(accountPubkey, rumor.pubkey);
      senderName = sender.name;
      avatarUrl = sender.picture;
      if (conversation?.name) {
        groupName = conversation.name;
      } else {
        const members = (conversation?.memberPubkeys ?? []).slice(0, 3);
        const names = await Promise.all(
          members.map(async (pubkey) => (await resolveIdentity(accountPubkey, pubkey)).name),
        );
        const remaining = Math.max(0, (conversation?.memberPubkeys?.length ?? 0) - names.length);
        groupName = remaining > 0
          ? i18n.t('group.derived_title_with_others', {
              names: names.join(', '),
              count: remaining,
            })
          : names.join(', ') || i18n.t('group.unnamed');
      }
    }

    let messageContent: string | null;
    if (
      action.status === 'valid' &&
      action.action.type !== 'create'
    ) {
      if (!options.includeIdentity) {
        messageContent = action.action.type === 'invite'
          ? i18n.t('group.member_invited')
          : action.action.type === 'remove'
            ? action.action.memberPubkey === rumor.pubkey
              ? i18n.t('group.member_left')
              : i18n.t('group.member_removed')
            : i18n.t('group.name_changed');
      } else if (action.action.type === 'rename') {
        messageContent = action.action.name
          ? i18n.t('group.renamed', { actor: senderName, name: action.action.name })
          : i18n.t('group.cleared_name', { actor: senderName });
      } else {
        const member = await resolveIdentity(accountPubkey, action.action.memberPubkey);
        messageContent = action.action.type === 'invite'
          ? i18n.t('group.invited', { actor: senderName, member: member.name })
          : action.action.memberPubkey === rumor.pubkey
            ? i18n.t('group.left', { actor: senderName })
            : i18n.t('group.removed', { actor: senderName, member: member.name });
      }
    } else {
      messageContent = rumor.kind === KIND_FILE
        ? attachmentLabel(rumor.tags, {
            file: i18n.t('conversations.attachment_file_preview'),
            image: i18n.t('conversations.attachment_image_preview'),
            video: i18n.t('conversations.attachment_video_preview'),
            voice: i18n.t('conversations.attachment_voice_preview'),
          })
        : rumor.content.trim() || null;
    }
    return {
      displayName: groupName,
      senderName,
      messageContent,
      avatarUrl,
      group: true,
    };
  }

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
