import { proximityConversationMessageUpdate } from '../proximity-conversation-state';

describe('proximity conversation state', () => {
  test('restores an existing conversation to the inbox for a newest message', () => {
    expect(
      proximityConversationMessageUpdate({
        newest: true,
        createdAt: 123,
        orderAt: 123_456,
        messageId: 'message-id',
      }),
    ).toEqual({
      hasReplied: true,
      lastMessageAt: 123,
      lastMessageOrderAt: 123_456,
      lastMessageId: 'message-id',
      deleted: false,
    });
  });

  test('does not revive a deleted conversation for an older message', () => {
    expect(
      proximityConversationMessageUpdate({
        newest: false,
        createdAt: 123,
        orderAt: 123_456,
        messageId: 'message-id',
      }),
    ).toEqual({ hasReplied: true });
  });
});
