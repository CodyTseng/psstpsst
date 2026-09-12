import { Image } from 'expo-image';
import { Play } from '@solar-icons/react-native/category/video/Linear/Play';
import { memo } from 'react';
import { View } from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';

import { useAttachment } from '@/hooks/use-attachment';
import type { ConversationMediaItem } from '@/hooks/use-conversation-media';
import { mediaViewer, type MediaViewerPreview } from '@/stores/media-viewer.store';
import { useThemeColors } from '@/theme';

type Props = {
  item: ConversationMediaItem;
  size: number;
  conversationKey: string;
  autoLoad: boolean;
};

/**
 * One square cell of the media grid. Encrypted images resolve their persistent
 * local copy lazily; direct images use expo-image's native cache. Non-contact
 * thumbnails resolve only local attachments until the user opens an item. Both show the
 * ThumbHash while loading. Videos are **not** loaded for the grid (they can be
 * large) — the ThumbHash plus a play badge stands in until the player opens.
 */
function MediaThumbnailBase({ item, size, conversationKey, autoLoad }: Props) {
  const c = useThemeColors();
  const placeholder = item.meta.thumbhash ? { thumbhash: item.meta.thumbhash } : undefined;

  // Built from props only (stable per cell), so the memo below isn't defeated by
  // a fresh closure each render — opens the pager anchored on this item.
  const open = (preview?: MediaViewerPreview) =>
    mediaViewer.openConversation({
      conversationKey,
      focusMessageId: item.messageId,
      focusOrderAt: item.orderAt,
      focusUrl: item.meta.url,
      fromGallery: true,
      preview,
    });

  return item.isVideo ? (
    <Pressable onPress={() => open()} style={{ width: size, height: size }}>
      <View style={{ flex: 1, backgroundColor: c.surfaceMuted, overflow: 'hidden' }}>
        <VideoCell placeholder={placeholder} />
      </View>
    </Pressable>
  ) : item.source === 'attachment' ? (
    <AttachmentImageCell autoLoad={autoLoad} item={item} placeholder={placeholder} size={size} onOpen={open} />
  ) : (
    <ImageCell uri={autoLoad ? item.meta.url : undefined} cacheKey={item.meta.sha256 ?? item.meta.url} placeholder={placeholder} size={size} onOpen={open} />
  );
}

type ImageCellProps = {
  uri?: string;
  cacheKey?: string;
  size: number;
  placeholder: { thumbhash: string } | undefined;
  onOpen: (preview?: MediaViewerPreview) => void;
};

function AttachmentImageCell({ item, autoLoad, ...props }: Omit<ImageCellProps, 'uri' | 'cacheKey'> & {
  item: Extract<ConversationMediaItem, { source: 'attachment' }>;
  autoLoad: boolean;
}) {
  const { state } = useAttachment(item.meta, { autoLoad });
  return <ImageCell {...props} uri={state.status === 'ready' ? state.localUri : undefined} />;
}

function ImageCell({ uri, cacheKey, size, placeholder, onOpen }: ImageCellProps) {
  const c = useThemeColors();
  return (
    <Pressable
      onPress={() => onOpen(uri ? { uri, cacheKey } : undefined)}
      style={{ width: size, height: size, backgroundColor: c.surfaceMuted, overflow: 'hidden' }}
    >
      <Image
        source={uri ? { uri, cacheKey } : undefined}
        placeholder={placeholder}
        placeholderContentFit="cover"
        style={{ width: '100%', height: '100%' }}
        contentFit="cover"
        transition={150}
        cachePolicy="memory-disk"
        recyclingKey={cacheKey ?? uri}
      />
    </Pressable>
  );
}

function VideoCell({ placeholder }: { placeholder: { thumbhash: string } | undefined }) {
  const c = useThemeColors();
  return (
    <>
      <Image
        placeholder={placeholder}
        placeholderContentFit="cover"
        style={{ width: '100%', height: '100%' }}
        contentFit="cover"
      />
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: 17,
            backgroundColor: c.overlay,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Play size={16} color={c.onOverlay} fill={c.onOverlay} />
        </View>
      </View>
    </>
  );
}

export const MediaThumbnail = memo(MediaThumbnailBase);
