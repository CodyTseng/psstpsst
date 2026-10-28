import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

/** Hash ratios are approximate; fit the metadata rectangle, then fill it. */
export function MediaImagePlaceholder({ thumbhash, blurhash, aspectRatio }: {
  thumbhash?: string;
  blurhash?: string;
  aspectRatio?: number;
}) {
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const placeholder = thumbhash ? { thumbhash } : blurhash ? { blurhash } : undefined;
  const aspect = aspectRatio && Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : undefined;
  const width = aspect ? Math.min(viewport.width, viewport.height * aspect) : viewport.width;
  const height = aspect ? width / aspect : viewport.height;
  return (
    <View
      style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }, { pointerEvents: 'none' }]}
      onLayout={({ nativeEvent: { layout } }) => setViewport((previous) =>
        previous.width === layout.width && previous.height === layout.height
          ? previous : { width: layout.width, height: layout.height })}
    >
      {placeholder && width > 0 && height > 0 ? (
        <Image
          placeholder={placeholder}
          placeholderContentFit={aspect ? 'fill' : 'contain'}
          contentFit={aspect ? 'fill' : 'contain'}
          style={{ width, height }}
        />
      ) : null}
    </View>
  );
}
