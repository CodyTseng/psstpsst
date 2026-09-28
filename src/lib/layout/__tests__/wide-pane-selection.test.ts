import { getWidePaneSelection } from '../wide-pane-selection';

describe('wide pane selection', () => {
  it.each([
    ['/chat/alice', 'alice'],
    ['/chat-search/alice', 'alice'],
    ['/media/alice', 'alice'],
    ['/chat/group%3Aabc', 'group:abc'],
    ['/group/group%3Aabc', 'group:abc'],
  ])('maps %s to conversation %s', (pathname, expected) => {
    expect(getWidePaneSelection(pathname).conversationKey).toBe(expected);
  });

  it('keeps a conversation selected on a profile opened from its chat', () => {
    expect(getWidePaneSelection('/profile/alice', true).conversationKey).toBe('alice');
    expect(getWidePaneSelection('/profile/alice').conversationKey).toBeNull();
  });

  it('maps a profile route to its contact', () => {
    expect(getWidePaneSelection('/profile/alice').profilePubkey).toBe('alice');
  });

  it('maps the group list to the contacts entry', () => {
    expect(getWidePaneSelection('/groups').contactsItem).toBe('groups');
  });

  it.each([
    ['/account', 'account'],
    ['/encryption-key', 'account'],
    ['/wallet-transaction/1', 'wallet'],
    ['/quick-reactions', 'chats'],
    ['/emoji-pack/example', 'chats'],
    ['/emoji-author/alice', 'chats'],
    ['/media-servers', 'media-servers'],
    ['/about', 'about'],
  ] as const)('maps %s to settings item %s', (pathname, expected) => {
    expect(getWidePaneSelection(pathname).settingsItem).toBe(expected);
  });

  it('leaves the primary rows clear on a tab route', () => {
    expect(getWidePaneSelection('/contacts')).toEqual({
      conversationKey: null,
      profilePubkey: null,
      settingsItem: null,
      contactsItem: null,
    });
  });
});
