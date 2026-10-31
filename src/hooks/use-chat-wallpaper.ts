import { useEffect } from 'react';
import { useStore } from 'zustand';

import { loadWallpaper, wallpaperStore, type WallpaperScope } from '@/services/preferences/chat-wallpaper.service';

export function useWallpaperPreference(scope?: WallpaperScope) {
  const store = wallpaperStore(scope);
  const state = useStore(store);
  const accountPubkey = scope?.accountPubkey;
  const conversationKey = scope?.conversationKey;
  useEffect(() => {
    void loadWallpaper(accountPubkey && conversationKey ? { accountPubkey, conversationKey } : undefined);
  }, [accountPubkey, conversationKey]);
  return state;
}

export function useChatWallpaper(scope: WallpaperScope): string | null {
  const global = useWallpaperPreference();
  const local = useWallpaperPreference(scope);
  // Never briefly reveal the global image while a local override is loading.
  if (!local.loaded) return null;
  return local.value === null ? global.uri : local.uri;
}
