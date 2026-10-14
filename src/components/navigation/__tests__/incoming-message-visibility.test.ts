import { incomingMessageVisibility } from '../incoming-message-visibility';

function state(tab: string, detail?: string, key = 'alice') {
  return {
    index: detail ? 1 : 0,
    routes: [
      { name: '(tabs)', state: { index: 0, routes: [{ name: tab }] } },
      ...(detail ? [{ name: detail, params: { key } }] : []),
    ],
  };
}

it.each([false, true])('suppresses banners on Chats with wide=%s', (wide) => {
  expect(incomingMessageVisibility(state('index'), wide)).toEqual({
    chatsVisible: true, activeConversationKey: null,
  });
});

it.each(['contacts', 'me'])('allows banners on the compact %s tab', (tab) => {
  expect(incomingMessageVisibility(state(tab), false)).toEqual({
    chatsVisible: false, activeConversationKey: null,
  });
});

it('does not treat the covered compact Chats tab as visible', () => {
  expect(incomingMessageVisibility(state('index', 'chat/[key]'), false)).toEqual({
    chatsVisible: false, activeConversationKey: 'alice',
  });
});

it('suppresses banners when wide Chats remains visible beside any detail', () => {
  expect(incomingMessageVisibility(state('index', 'chat/[key]'), true)).toEqual({
    chatsVisible: true, activeConversationKey: 'alice',
  });
  expect(incomingMessageVisibility(state('index', 'settings/about'), true).chatsVisible).toBe(true);
});

it.each(['contacts', 'me'])('allows other-conversation banners beside the wide %s tab', (tab) => {
  expect(incomingMessageVisibility(state(tab, 'chat/[key]'), true)).toEqual({
    chatsVisible: false, activeConversationKey: 'alice',
  });
});

it('does not treat a profile or chat search as the visible conversation', () => {
  for (const detail of ['profile/[pubkey]', 'chat-search/[key]', 'settings/about']) {
    expect(incomingMessageVisibility(state('me', detail), true)).toEqual({
      chatsVisible: false, activeConversationKey: null,
    });
  }
});

it('uses the selected tab index and defaults uninitialized tabs to Chats', () => {
  expect(incomingMessageVisibility({ index: 0, routes: [{ name: '(tabs)' }] }, false)
    .chatsVisible).toBe(true);
  expect(incomingMessageVisibility({ index: 1, routes: [
    { name: '(tabs)', state: { index: 1, routes: [{ name: 'index' }, { name: 'contacts' }] } },
    { name: 'chat/[key]', params: { key: 'alice' } },
  ] }, true)).toEqual({ chatsVisible: false, activeConversationKey: 'alice' });
});
