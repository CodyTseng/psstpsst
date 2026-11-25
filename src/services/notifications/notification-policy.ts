import type { Rumor } from '@/db/schema/types';
import i18n from '@/i18n';
import type { NotificationCommunication } from '@/platform/ports/notifications';
import { resolveDisplayName } from '@/lib/nostr/display-name';
import { disappearingMessageDuration } from '@/lib/nostr/disappearing-message';
import { KIND_REACTION } from '@/services/crypto/nip17-gift-wrap';

import { discardNotificationEvents } from './notification-events.service';
import { filterNotifiableMessages, type NotificationCandidate, type NotificationConversation } from './notification-filter';
import { getNotificationPreview } from './notification-preview';
import {
  getNotificationContentPreferences,
  type NotificationContentPreferences,
} from './notification-prefs';

/** Shared by live delivery, recovery and the independent iOS extension. */
export async function evaluateNotificationRumors(
  rumors: Rumor[],
  accountPubkey: string,
  userPresent: boolean,
  deliveryKind?: NotificationConversation['deliveryKind'],
): Promise<NotificationCandidate[]> {
  if (userPresent) {
    await discardNotificationEvents(accountPubkey, 'system');
    return [];
  }
  return filterNotifiableMessages(rumors, accountPubkey, deliveryKind);
}

/** Resolve the same private-by-default presentation in every runtime. */
export async function buildNotificationContent(
  latest: Rumor,
  count: number,
  accountPubkey: string,
  options: {
    preferences?: NotificationContentPreferences;
    hasReactions?: boolean;
    conversation: NotificationConversation;
  },
): Promise<{ title: string; subtitle?: string; body?: string; avatarUrl?: string; communication?: NotificationCommunication }> {
  const contentPreferences = options.preferences ?? await getNotificationContentPreferences();
  const reaction = latest.kind === KIND_REACTION;
  const hasReactions = options.hasReactions ?? reaction;
  const genericTitle = count > 1
    ? hasReactions ? i18n.t('notifications.new_activity') : i18n.t('notifications.new_messages', { count })
    : reaction ? i18n.t('notifications.new_reaction')
      : i18n.t(options.conversation.groupId ? 'group.new_message' : 'notifications.new_message');
  const showMessageContent = contentPreferences.showMessageContent && disappearingMessageDuration(latest) === null;
  const preview = contentPreferences.showSender || showMessageContent
    ? await getNotificationPreview(latest, accountPubkey, {
        includeIdentity: contentPreferences.showSender,
        conversation: options.conversation,
      })
    : null;
  const title = contentPreferences.showSender && preview?.displayName
    ? preview.displayName : genericTitle;
  return {
    title,
    subtitle: title !== genericTitle && count > 1 ? genericTitle : undefined,
    body: showMessageContent
      ? preview?.group && contentPreferences.showSender && preview.senderName && preview.messageContent
        ? `${preview.senderName}: ${preview.messageContent}`
        : preview?.messageContent ?? undefined
      : i18n.t('notifications.open_to_view_message'),
    communication: contentPreferences.showSender ? {
      senderId: latest.pubkey,
      senderName: preview?.senderName ?? preview?.displayName ?? resolveDisplayName(latest.pubkey),
      recipientId: accountPubkey,
      conversationId: `${accountPubkey}:${options.conversation.conversationKey}`,
      groupName: preview?.group ? preview.displayName ?? undefined : undefined,
    } : undefined,
    avatarUrl: contentPreferences.showSender ? preview?.avatarUrl ?? undefined : undefined,
  };
}
