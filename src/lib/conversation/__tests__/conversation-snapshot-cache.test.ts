import {
  getSessionCachedConversation,
  rememberConversationSnapshot,
  type ConversationSnapshot,
} from '../conversation-snapshot-cache';

function snapshot(
  accountPubkey: string,
  conversationKey: string,
  name: string,
): ConversationSnapshot {
  return {
    accountPubkey,
    conversationKey,
    name,
    memberPubkeys: ['member-a', 'member-b'],
  } as ConversationSnapshot;
}

describe('conversation snapshot cache', () => {
  it('returns the warm row synchronously for the matching account and conversation', () => {
    const row = snapshot('account-a', `group:${'a'.repeat(64)}`, 'Warm group');
    rememberConversationSnapshot(row);

    expect(
      getSessionCachedConversation(row.accountPubkey, row.conversationKey),
    ).toBe(row);
  });

  it('keeps equal conversation keys isolated by account', () => {
    const key = `group:${'b'.repeat(64)}`;
    const first = snapshot('account-a', key, 'First account');
    const second = snapshot('account-b', key, 'Second account');
    rememberConversationSnapshot(first);
    rememberConversationSnapshot(second);

    expect(getSessionCachedConversation('account-a', key)).toBe(first);
    expect(getSessionCachedConversation('account-b', key)).toBe(second);
  });
});
