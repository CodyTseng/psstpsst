import { Image } from 'expo-image';
import { memo } from 'react';
import { View } from 'react-native';

import { useCachedImages } from '@/hooks/use-cached-images';
import { IconButton } from '@/components/common/IconButton';
import type { CustomEmoji } from '@/lib/nostr/custom-emoji';
import { showCustomEmojiDetail } from '@/stores/custom-emoji-detail.store';

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
        source={localUri ? { uri: localUri } : undefined}
        accessibilityLabel={emoji.shortcode}
        cachePolicy="memory-disk"
        contentFit="contain"
        autoplay
        style={{ width: size, height: size }}
      />
    </View>
  );
  if (!clickable || size === '100%') return image;
  return (
    <IconButton
      disabled={!localUri}
      variant="plain"
      shape="square"
      size={size}
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
