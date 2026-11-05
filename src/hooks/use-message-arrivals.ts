import { useEffect, useState } from 'react';

import type { ConversationWithLast } from '@/hooks/use-conversations';
import { selectIncomingNotification } from '@/components/chat/incoming-message-banner-state';
import { isMessageOrderNewer } from '@/lib/nostr/message-order';
import { platform } from '@/platform';
import { discardNotificationEvents, takeNotificationEvents } from '@/services/notifications/notification-events.service';

/** Database changes wake a bounded event consumer, including extension-owned
 * writes. No conversation-list snapshot can create or consume a notification. */
export function useIncomingMessageArrival(accountPubkey: string, options: {
  ready: boolean;
  enabled: boolean;
  quietRequests: boolean;
  chatsVisible: boolean;
  activeConversationKey: string | null;
}): ConversationWithLast | null {
  const { ready, enabled, quietRequests, chatsVisible, activeConversationKey } = options;
  const [arrival, setArrival] = useState<ConversationWithLast | null>(null);
  useEffect(() => {
    if (!ready || !accountPubkey) return;
    let active = true;
    let running = false;
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (!active) return;
      pending = true;
      if (running || timer) return;
      timer = setTimeout(() => { timer = null; void drain(); }, 0);
    };
    const drain = async () => {
      running = true;
      pending = false;
      try {
        if (platform.notifications.shouldNotifyNow()) {
          await discardNotificationEvents(accountPubkey, 'foreground');
          return;
        }
        let throughId: number | undefined;
        let newest: ConversationWithLast | null = null;
        while (active) {
          const batch = await takeNotificationEvents(accountPubkey, 'foreground', throughId);
          if (!active) return;
          if (enabled && !platform.notifications.shouldNotifyNow()) {
            const next = selectIncomingNotification(batch.events, activeConversationKey, { quietRequests, chatsVisible });
            if (next && (!newest || isMessageOrderNewer(
              { orderAt: next.conversation.lastMessageOrderAt!, id: next.conversation.lastMessageId! },
              { orderAt: newest.conversation.lastMessageOrderAt!, id: newest.conversation.lastMessageId! },
            ))) newest = next;
          }
          if (!batch.more) break;
          throughId = batch.throughId;
        }
        // Keep one winner across bounded pages and publish the completed batch once.
        if (active && enabled && newest && !platform.notifications.shouldNotifyNow()) setArrival(newest);
      } catch (error) {
        pending = false;
        console.warn('[notifications] Unable to consume foreground events.', error);
      } finally {
        running = false;
        if (pending) schedule();
      }
    };
    const removeDatabase = platform.database.addChangeListener(event => {
      if (!event.tableName || ['notification_events', 'device_preferences', 'conversations'].includes(event.tableName)) schedule();
    });
    const removePresence = platform.notifications.addUserReturnedListener(schedule);
    const removeAppState = platform.appState.addChangeListener(schedule);
    schedule();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      removeDatabase(); removePresence(); removeAppState();
    };
  }, [accountPubkey, ready, enabled, quietRequests, chatsVisible, activeConversationKey]);
  return arrival;
}
