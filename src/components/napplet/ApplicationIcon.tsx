import { memo, useEffect, useState, type Ref } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Earth } from '@solar-icons/react-native/category/astronomy/Linear/Earth';
import { Widget } from '@solar-icons/react-native/category/settings/Linear/Widget';
import { AppText } from '@/components/common/AppText';
import { applicationIconKey, loadApplicationIcon, websiteIconOrigin, type ApplicationIconSource } from '@/services/explore/icons';
import { peekWebsiteIcon, retryWebsiteIcon, subscribeWebsiteIcon } from '@/services/explore/website-icons';
import { radius, spacing, useThemeColors } from '@/theme';

export const APPLICATION_ICON_SIZE = spacing['3xl'] + spacing.lg;
export const ApplicationIcon = memo(function ApplicationIcon({ release, size = APPLICATION_ICON_SIZE, iconRef, loadRemote = true }: { release: ApplicationIconSource & { title?: string }; size?: number; iconRef?: Ref<View>; loadRemote?: boolean }) {
  const c = useThemeColors();
  const origin = websiteIconOrigin(release);
  const iconKey = applicationIconKey(release);
  const [loaded, setLoaded] = useState<{ key: string; uri?: string }>();
  const [displayed, setDisplayed] = useState<{ key: string; uri: string }>();
  const uri = loaded?.key === iconKey ? loaded.uri : origin ? peekWebsiteIcon(origin) : undefined;
  const firstCodePoint = release.title?.trimStart().codePointAt(0);
  const initial = firstCodePoint === undefined ? '' : String.fromCodePoint(firstCodePoint).toUpperCase();
  const showFallback = !uri || displayed?.key !== iconKey || displayed.uri !== uri;
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
    <View ref={iconRef} testID="application-icon"
      style={{
        width: size,
        height: size,
        borderRadius: Math.min(radius.xl, size / 4),
        backgroundColor: showFallback ? c.surfaceElevated : c.surfaceMuted,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {showFallback ? (
        initial ? <AppText variant={size < spacing['2xl'] ? 'body' : size < spacing['3xl'] ? 'title' : 'display'}
          weight="semibold" align="center" naturalLineHeight numberOfLines={1}>{initial}</AppText>
          : origin ? <Earth size={spacing.xl} color={c.textMuted} /> : <Widget size={spacing.xl} color={c.textMuted} />
      ) : null}
      {uri ? (
        <Image
          key={`${iconKey}:${uri}`}
          source={{ uri }}
          draggable={false}
          contentFit={origin || release.files ? 'contain' : 'cover'}
          onDisplay={() => setDisplayed({ key: iconKey, uri })}
          onError={() => {
            setLoaded({ key: iconKey });
            if (loadRemote && origin && uri) void retryWebsiteIcon(origin, uri);
          }}
          style={{ position: 'absolute', width: '100%', height: '100%' }}
        />
      ) : null}
      {showFallback ? <View pointerEvents="none" style={{ ...StyleSheet.absoluteFill,
        borderRadius: Math.min(radius.xl, size / 4), borderWidth: StyleSheet.hairlineWidth, borderColor: c.border }} /> : null}
    </View>
  );
});
