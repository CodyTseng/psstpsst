export type SettingsSelection =
  | 'account'
  | 'blocked-users'
  | 'wallet'
  | 'chats'
  | 'notifications'
  | 'appearance'
  | 'language'
  | 'relays'
  | 'media-servers'
  | 'data'
  | 'about';

export type WidePaneSelection = {
  conversationKey: string | null;
  profilePubkey: string | null;
  settingsItem: SettingsSelection | null;
};

const SETTINGS_ITEM_BY_ROUTE: Readonly<Record<string, SettingsSelection>> = {
  account: 'account',
  'encryption-key': 'account',
  'blocked-users': 'blocked-users',
  wallet: 'wallet',
  'wallet-add': 'wallet',
  'wallet-send': 'wallet',
  'wallet-receive': 'wallet',
  'wallet-transaction': 'wallet',
  'wallet-invoice': 'wallet',
  chats: 'chats',
  'quick-reactions': 'chats',
  'emoji-packs': 'chats',
  'personal-emojis': 'chats',
  'emoji-pack': 'chats',
  'emoji-author': 'chats',
  'emoji-pack-editor': 'chats',
  'add-custom-emoji': 'chats',
  notifications: 'notifications',
  appearance: 'appearance',
  language: 'language',
  relays: 'relays',
  'media-servers': 'media-servers',
  data: 'data',
  about: 'about',
  'open-source': 'about',
  'open-source-project': 'about',
};

function routeValue(pathname: string, route: string): string | null {
  const prefix = `/${route}/`;
  if (!pathname.startsWith(prefix)) return null;
  const value = pathname.slice(prefix.length).split('/')[0];
  return value || null;
}

/** Maps the globally selected detail route back to its persistent primary row. */
export function getWidePaneSelection(
  pathname: string,
  profileOpenedFromChat = false,
): WidePaneSelection {
  const chatKey = routeValue(pathname, 'chat');
  const chatSearchKey = routeValue(pathname, 'chat-search');
  const mediaConversationKey = routeValue(pathname, 'media');
  const profilePubkey = routeValue(pathname, 'profile');
  const rootRoute = pathname.split('/').filter(Boolean)[0] ?? '';

  return {
    conversationKey:
      chatKey ??
      chatSearchKey ??
      mediaConversationKey ??
      (profileOpenedFromChat ? profilePubkey : null),
    profilePubkey,
    settingsItem: SETTINGS_ITEM_BY_ROUTE[rootRoute] ?? null,
  };
}
