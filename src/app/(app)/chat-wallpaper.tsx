import { useLocalSearchParams } from 'expo-router';

import { InvalidRouteRedirect } from '@/components/navigation/InvalidRouteRedirect';
import { ChatWallpaperSettings } from '@/components/settings/chat-wallpaper-settings';
import { routeConversationKeyParam } from '@/lib/navigation/route-params';
import { useActiveAccount } from '@/stores/active-account.store';

export default function ChatWallpaperScreen() {
  const params = useLocalSearchParams<{ key?: string | string[] }>();
  const accountPubkey = useActiveAccount((state) => state.activePubkey) ?? '';
  const conversationKey = params.key === undefined ? undefined : routeConversationKeyParam(params.key);
  if (conversationKey === null) return <InvalidRouteRedirect />;
  return <ChatWallpaperSettings key={`${accountPubkey}:${conversationKey ?? ''}`}
    scope={conversationKey ? { accountPubkey, conversationKey } : undefined} />;
}
