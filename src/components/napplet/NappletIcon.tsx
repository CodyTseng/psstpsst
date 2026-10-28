import { memo, useEffect, useState, type Ref } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { Earth } from '@solar-icons/react-native/category/astronomy/Linear/Earth';
import { Widget } from '@solar-icons/react-native/category/settings/Linear/Widget';
import { applicationIconKey, loadApplicationIcon, websiteIconOrigin, type ApplicationIconSource } from '@/services/explore/icons';
import { peekWebsiteIcon, retryWebsiteIcon, subscribeWebsiteIcon } from '@/services/explore/website-icons';
import { radius, spacing, useThemeColors } from '@/theme';

export const NAPPLET_ICON_SIZE = spacing['3xl'] + spacing.lg;
export const NappletIcon = memo(function NappletIcon({ release, size = NAPPLET_ICON_SIZE, iconRef, loadRemote = true }: { release: ApplicationIconSource; size?: number; iconRef?: Ref<View>; loadRemote?: boolean }) {
  const c = useThemeColors();
  const origin = websiteIconOrigin(release);
  const iconKey = applicationIconKey(release);
  const [loaded, setLoaded] = useState<{ key: string; uri?: string }>();
  const uri = loaded?.key === iconKey ? loaded.uri : origin ? peekWebsiteIcon(origin) : undefined;
  useEffect(() => {
    if (!loadRemote) return;
    let active = true;
    const unsubscribe = origin ? subscribeWebsiteIcon(origin, value => {
      if (active) setLoaded({ key: iconKey, uri: value });
    }) : undefined;
    void loadApplicationIcon(release).then((value) => {
      if (active) setLoaded(previous => previous?.key === iconKey && previous.uri === value
        ? previous : { key: iconKey, uri: value });
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [release, iconKey, origin, loadRemote]);
  return (
    <View ref={iconRef} testID="napplet-icon"
      style={{
        width: size,
        height: size,
        borderRadius: Math.min(radius.xl, size / 4),
        backgroundColor: c.surfaceMuted,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {uri ? (
        <Image
          source={{ uri }}
          draggable={false}
          contentFit={origin || release.files ? 'contain' : 'cover'}
          onError={() => {
            setLoaded({ key: iconKey });
            if (loadRemote && origin && uri) void retryWebsiteIcon(origin, uri);
          }}
          style={{ width: '100%', height: '100%' }}
        />
      ) : (
        origin ? <Earth size={spacing.xl} color={c.textMuted} /> : <Widget size={spacing.xl} color={c.textMuted} />
      )}
    </View>
  );
});
