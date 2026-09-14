import type { ConversationWithLast } from '@/hooks/use-conversations';

import {
  conversationMessageBaseline,
  findIncomingConversation,
} from '../incoming-message-banner-state';

function item({
  key,
  messageId,
  sender = key,
  unreadCount = 1,
  orderAt = 1,
  muted = false,
  deliveryKind = 'relay',
}: {
  key: string;
  messageId: string;
  sender?: string;
  unreadCount?: number;
  orderAt?: number;
  muted?: boolean;
  deliveryKind?: 'relay' | 'proximity';
}): ConversationWithLast {
  return {
    conversation: {
      accountPubkey: 'self',
      conversationKey: key,
      deliveryKind,
      name: null,
      proximityAccountPubkey: null,
      lastMessageAt: orderAt,
      lastMessageOrderAt: orderAt,
      lastMessageId: messageId,
      lastReadAt: 0,
      lastReadOrderAt: 0,
      lastReadMessageId: null,
      unreadCount,
      hasReplied: true,
      muted,
      pinned: false,
      deleted: false,
      deletedAt: null,
      deletedOrderAt: null,
    },
    lastMessageContent: 'Hello',
    lastMessageKind: 14,
    lastMessageTags: [],
    lastMessageSenderPubkey: sender,
  };
}

describe('incoming message banner state', () => {
  it('does not surface messages present in the initial baseline', () => {
    const current = [item({ key: 'alice', messageId: 'm1' })];
    const baseline = conversationMessageBaseline(current);

    expect(findIncomingConversation(baseline, current, 'self', 'bob')).toBeNull();
  });

  it('selects the newest new incoming message outside the active chat', () => {
    const previous = conversationMessageBaseline([
      item({ key: 'alice', messageId: 'm1', unreadCount: 0 }),
      item({ key: 'carol', messageId: 'm2', unreadCount: 0 }),
    ]);
    const current = [
      item({ key: 'alice', messageId: 'm3', orderAt: 3 }),
      item({ key: 'carol', messageId: 'm4', orderAt: 4 }),
    ];

    expect(findIncomingConversation(previous, current, 'self', 'bob')?.conversation.conversationKey)
      .toBe('carol');
  });

  it('surfaces a newly-created conversation after the baseline is established', () => {
    const current = [item({ key: 'alice', messageId: 'm1' })];

    expect(findIncomingConversation(new Map(), current, 'self', 'bob')).toBe(current[0]);
  });

  it('does not treat manually marking an existing message unread as an arrival', () => {
    const previous = conversationMessageBaseline([
      item({ key: 'alice', messageId: 'm1', unreadCount: 0 }),
    ]);
    const current = [item({ key: 'alice', messageId: 'm1', unreadCount: 1 })];

    expect(findIncomingConversation(previous, current, 'self', 'bob')).toBeNull();
  });

  it('ignores the active chat, muted chats, and outgoing messages', () => {
    const previous = conversationMessageBaseline([
      item({ key: 'active', messageId: 'a1', unreadCount: 0 }),
      item({ key: 'muted', messageId: 'm1', unreadCount: 0 }),
      item({ key: 'outgoing', messageId: 'o1', unreadCount: 0 }),
    ]);
    const current = [
      item({ key: 'active', messageId: 'a2' }),
      item({ key: 'muted', messageId: 'm2', muted: true }),
      item({ key: 'outgoing', messageId: 'o2', sender: 'self' }),
    ];

    expect(findIncomingConversation(previous, current, 'self', 'active')).toBeNull();
  });

  it('treats the peer sender as incoming for Nearby conversations', () => {
    const previous = conversationMessageBaseline([
      item({ key: 'nearby-peer', messageId: 'm1', unreadCount: 0, deliveryKind: 'proximity' }),
    ]);
    const current = [
      item({ key: 'nearby-peer', messageId: 'm2', deliveryKind: 'proximity' }),
    ];

    expect(findIncomingConversation(previous, current, 'self', 'other')).toBe(current[0]);
  });
});
