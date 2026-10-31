import { Image } from 'expo-image';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { useChatWallpaper } from '@/hooks/use-chat-wallpaper';
import type { WallpaperScope } from '@/services/preferences/chat-wallpaper.service';
import { useThemeColors } from '@/theme';

/** One stationary image behind the timeline, independent of list cells and composer state. */
export const ChatWallpaper = memo(function ChatWallpaper(scope: WallpaperScope) {
  const uri = useChatWallpaper(scope);
  return <WallpaperCanvas uri={uri} />;
});

export function WallpaperCanvas({ uri }: { uri: string | null }) {
  const c = useThemeColors();
  if (!uri) return null;
  return (
    <View accessible={false} style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}>
      <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={uri} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: c.background, opacity: 0.7 }]} />
    </View>
  );
}
