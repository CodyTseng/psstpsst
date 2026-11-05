import type { Rumor } from '@/db/schema/types';
import i18n from '@/i18n';
import type { NotificationCommunication } from '@/platform/ports/notifications';
import { resolveDisplayName } from '@/lib/nostr/display-name';
import { firstGroupId } from '@/lib/nostr/group-messaging';

import { discardNotificationEvents } from './notification-events.service';
import { filterNotifiableMessages, type NotificationCandidate } from './notification-filter';
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
): Promise<NotificationCandidate[]> {
  if (userPresent) {
    await discardNotificationEvents(accountPubkey, 'system');
    return [];
  }
  return filterNotifiableMessages(rumors, accountPubkey);
}

/** Resolve the same private-by-default presentation in every runtime. */
export async function buildNotificationContent(
  latest: Rumor,
  count: number,
  accountPubkey: string,
  preferences?: NotificationContentPreferences,
): Promise<{ title: string; subtitle?: string; body?: string; avatarUrl?: string; communication?: NotificationCommunication }> {
  const contentPreferences = preferences ?? await getNotificationContentPreferences();
  const genericTitle = count <= 1
    ? i18n.t(firstGroupId(latest.tags) ? 'group.new_message' : 'notifications.new_message')
    : i18n.t('notifications.new_messages', { count });
  const preview = contentPreferences.showSender || contentPreferences.showMessageContent
    ? await getNotificationPreview(latest, accountPubkey, {
        includeIdentity: contentPreferences.showSender,
      })
    : null;
  const title = contentPreferences.showSender && preview?.displayName
    ? preview.displayName : genericTitle;
  return {
    title,
    subtitle: title !== genericTitle && count > 1 ? genericTitle : undefined,
    body: contentPreferences.showMessageContent
      ? preview?.group && contentPreferences.showSender && preview.senderName && preview.messageContent
        ? `${preview.senderName}: ${preview.messageContent}`
        : preview?.messageContent ?? undefined
      : i18n.t('notifications.open_to_view_message'),
    communication: contentPreferences.showSender ? {
      senderId: latest.pubkey,
      senderName: preview?.senderName ?? preview?.displayName ?? resolveDisplayName(latest.pubkey),
      recipientId: accountPubkey,
      conversationId: `${accountPubkey}:${firstGroupId(latest.tags) ?? latest.pubkey}`,
      groupName: preview?.group ? preview.displayName ?? undefined : undefined,
    } : undefined,
    avatarUrl: contentPreferences.showSender ? preview?.avatarUrl ?? undefined : undefined,
  };
}
