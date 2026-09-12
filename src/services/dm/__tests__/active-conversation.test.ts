import { isActiveConversationVisible } from '../active-conversation';

const active = { accountPubkey: 'account', conversationKey: 'conversation-a' };

describe('active conversation visibility', () => {
  it('treats a routed chat as active only while the user is present', () => {
    expect(isActiveConversationVisible(active, 'account', 'conversation-a', true)).toBe(true);
    expect(isActiveConversationVisible(active, 'account', 'conversation-a', false)).toBe(false);
  });

  it('rejects a different account or conversation', () => {
    expect(isActiveConversationVisible(active, 'other', 'conversation-a', true)).toBe(false);
    expect(isActiveConversationVisible(active, 'account', 'conversation-b', true)).toBe(false);
  });
});
