import type { ClaimedNotificationEvent } from '@/services/notifications/notification-events.service';
import { selectIncomingNotification } from '../incoming-message-banner-state';

const options = { chatsVisible: false, quietRequests: false };
function event(id: string, orderAt: number, kind: 'message' | 'request' = 'request'): ClaimedNotificationEvent {
  return {
    event: { kind },
    conversation: { conversationKey: id, lastMessageId: 'newer-head', hasReplied: kind === 'message' },
    message: { id, orderAt, createdAt: 100, content: 'source preview', kind: 14, tags: [], senderPubkey: id },
  } as unknown as ClaimedNotificationEvent;
}

it('presents the event source independently of a newer conversation head', () => {
  const next = selectIncomingNotification([event('first', 100)], null, options)!;
  expect(next.conversation.lastMessageId).toBe('first');
  expect(next.lastMessageContent).toBe('source preview');
});
it('selects the newest eligible event', () => {
  expect(selectIncomingNotification([event('b', 100), event('a', 200)], null, options)?.conversation.conversationKey).toBe('a');
});
it('suppresses the open conversation', () => {
  expect(selectIncomingNotification([event('open', 100)], 'open', options)).toBeNull();
});
it('allows request notices on Chats while hiding regular chat notices', () => {
  expect(selectIncomingNotification([event('chat', 200, 'message'), event('request', 100)], null,
    { ...options, chatsVisible: true })?.conversation.conversationKey).toBe('request');
});
it('quiet mode only suppresses requests', () => {
  expect(selectIncomingNotification([event('request', 200), event('chat', 100, 'message')], null,
    { ...options, quietRequests: true })?.conversation.conversationKey).toBe('chat');
});
