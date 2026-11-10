import { Image } from 'expo-image';
import { VideoView, type VideoViewProps } from 'expo-video';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useThemeColors } from '@/theme';

type Props = VideoViewProps & {
  sourceKey: string;
  posterUri?: string;
  thumbhash?: string;
  immersive?: boolean;
  showLoading?: boolean;
};

/** A new source owns a fresh cover and cannot receive the previous view's events. */
export function VideoSurface(props: Props) {
  return <CoveredVideoSurface key={props.sourceKey} {...props} />;
}

function CoveredVideoSurface({
  sourceKey, posterUri, thumbhash, immersive = false, showLoading = true,
  onFirstFrameRender, ...props
}: Props) {
  const c = useThemeColors();
  const [hasFrame, setHasFrame] = useState(false);
  return (
    <>
      <VideoView
        {...props}
        onFirstFrameRender={() => {
          setHasFrame(true);
          onFirstFrameRender?.();
        }}
      />
      {!hasFrame ? (
        <View
          testID="video-first-frame-cover"
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, {
            backgroundColor: immersive ? c.lightboxBackdrop : c.surfaceMuted,
            alignItems: 'center', justifyContent: 'center',
          }]}
        >
          {posterUri || thumbhash ? (
            <Image
              source={posterUri ? { uri: posterUri } : undefined}
              placeholder={thumbhash ? { thumbhash } : undefined}
              contentFit={props.contentFit ?? 'contain'}
              placeholderContentFit={props.contentFit ?? 'contain'}
              cachePolicy="memory-disk"
              recyclingKey={sourceKey}
              style={StyleSheet.absoluteFill}
            />
          ) : null}
          {showLoading ? <ActivityIndicator color={immersive || posterUri || thumbhash ? c.onOverlay : c.textMuted} /> : null}
        </View>
      ) : null}
    </>
  );
}
