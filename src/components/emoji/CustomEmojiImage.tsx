import { Image } from 'expo-image';
import { memo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useCachedImages } from '@/hooks/use-cached-images';
import { IconButton } from '@/components/common/IconButton';
import type { CustomEmoji } from '@/lib/nostr/custom-emoji';
import { showCustomEmojiDetail } from '@/stores/custom-emoji-detail.store';
import { spacing, useThemeColors } from '@/theme';

type Props = {
  emoji: CustomEmoji;
  cornerRadius?: number;
  hoverFeedback?: boolean;
  /** Preserve the image frame without requesting bytes during chat entry. */
  loadRemote?: boolean;
  /** Explicit local source resolved by a parent download gate. */
  sourceUri?: string | null;
} & (
  | { size: number; clickable?: boolean }
  | { size: '100%'; clickable: false }
);

/** Cached custom-emoji image with an optional pack-detail tap target. */
export const CustomEmojiImage = memo(function CustomEmojiImage({
  emoji,
  size,
  clickable = true,
  cornerRadius = 0,
  hoverFeedback = true,
  loadRemote = true,
  sourceUri,
}: Props) {
  const cached = useCachedImages(sourceUri === undefined ? [emoji.url] : [], loadRemote);
  const localUri = sourceUri === undefined ? cached[0]?.uri : sourceUri;
  const image = (
    <EmojiImageFrame
      key={emoji.url}
      uri={localUri}
      shortcode={emoji.shortcode}
      size={size}
      cornerRadius={cornerRadius}
      clickable={clickable}
      loading={!!localUri || (loadRemote && !cached[0]?.failed)}
    />
  );
  if (!clickable || size === '100%') return image;
  return (
    <IconButton
      disabled={!localUri}
      variant="plain"
      shape="square"
      size={size}
      style={{ borderRadius: cornerRadius }}
      hoverFeedback={hoverFeedback}
      onPress={() => showCustomEmojiDetail(emoji)}
      accessibilityLabel={emoji.shortcode}
      icon={image}
    />
  );
}, (previous, next) =>
  previous.emoji.shortcode === next.emoji.shortcode &&
  previous.emoji.url === next.emoji.url &&
  previous.emoji.setAddress === next.emoji.setAddress &&
  previous.size === next.size &&
  previous.clickable === next.clickable &&
  previous.cornerRadius === next.cornerRadius &&
  previous.hoverFeedback === next.hoverFeedback &&
  previous.loadRemote === next.loadRemote &&
  previous.sourceUri === next.sourceUri
);

/** Reset display state when a resolved source changes without moving the frame. */
function EmojiImageFrame({ uri, shortcode, size, cornerRadius, clickable, loading }: {
  uri: string | null | undefined;
  shortcode: string;
  size: number | '100%';
  cornerRadius: number;
  clickable: boolean;
  loading: boolean;
}) {
  const c = useThemeColors();
  const [state, setState] = useState<{
    uri: typeof uri;
    status: 'loading' | 'displayed' | 'failed';
  }>({ uri, status: 'loading' });
  if (state.uri !== uri) setState({ uri, status: 'loading' });
  const status = state.uri === uri ? state.status : 'loading';
  function settle(status: 'displayed' | 'failed') {
    setState((previous) => previous.uri === uri ? { uri, status } : previous);
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: cornerRadius,
        borderCurve: 'continuous',
        overflow: 'hidden',
        pointerEvents: clickable ? 'auto' : 'none',
      }}
    >
      <Image
        source={uri ? { uri } : undefined}
        accessibilityLabel={shortcode}
        cachePolicy="memory-disk"
        contentFit="contain"
        autoplay
        onDisplay={() => settle('displayed')}
        onError={() => settle('failed')}
        style={{ width: size, height: size }}
      />
      {status !== 'displayed' ? (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: c.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
          ]}
        >
          {loading && status === 'loading' ? (
            <ActivityIndicator
              size="small"
              color={c.textMuted}
              style={typeof size === 'number'
                ? { transform: [{ scale: Math.min(1, size / spacing.xl) }] }
                : undefined}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
