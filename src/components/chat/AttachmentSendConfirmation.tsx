import { FileText } from '@solar-icons/react-native/category/files/Linear/FileText';
import { Plain3 as Send } from '@solar-icons/react-native/category/messages/Linear/Plain3';
import { TrashBinTrash as Trash } from '@solar-icons/react-native/category/ui/Linear/TrashBinTrash';
import { Gallery } from '@solar-icons/react-native/category/video/Linear/Gallery';
import { MusicNote } from '@solar-icons/react-native/category/video/Linear/MusicNote';
import { Play } from '@solar-icons/react-native/category/video/Linear/Play';
import { VideoFramePlayHorizontal } from '@solar-icons/react-native/category/video/Linear/VideoFramePlayHorizontal';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, TextInput, useWindowDimensions, View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { BottomSheet } from '@/components/common/BottomSheet';
import { DialogSurface } from '@/components/common/DialogSurface';
import { IconButton } from '@/components/common/IconButton';
import { ListRow } from '@/components/common/ListRow';
import X from 'lucide-react-native/icons/x';
import {
  composerMediaKind,
  type BrowserFile,
  type ComposerMediaKind,
} from '@/lib/attachments/composer-file';
import {
  DEFAULT_IMAGE_SEND_QUALITY,
  type ImageSendQuality,
} from '@/lib/attachments/image-quality';
import { formatFileSize } from '@/lib/nostr/file-tags';
import { IS_ELECTRON } from '@/lib/platform';
import { useDirectionalIconStyle } from '@/i18n/direction';
import { iconStrokeWidth } from '@/theme/icons';
import {
  contentWidth,
  radius,
  spacing,
  typography,
  uiDensity,
  useThemeColors,
} from '@/theme';

export type PickedAttachment = {
  uri: string;
  mime: string;
  name?: string;
  size?: number;
  width?: number;
  height?: number;
};

export type AttachmentConfirmationFile = {
  source:
    | { kind: 'uri'; uri: string }
    | { kind: 'browser'; file: BrowserFile };
  mime: string;
  name?: string;
  size?: number;
  width?: number;
  height?: number;
};

type Props = {
  visible: boolean;
  files: readonly AttachmentConfirmationFile[];
  onClose: () => void;
  onClosed?: () => void;
  onConfirm: (imageQuality: ImageSendQuality, message: string) => void;
  onRemoveFile: (index: number) => void;
  onImageDimensions: (index: number, width: number, height: number) => void;
};

type ContentProps = Pick<Props, 'files' | 'onRemoveFile' | 'onImageDimensions'> & {
  imageQuality: ImageSendQuality;
  onImageQualityChange: (quality: ImageSendQuality) => void;
  message: string;
  onMessageChange: (message: string) => void;
  onSubmit: () => void;
  sendDisabled: boolean;
  inputBackgroundColor: string;
};

const PREVIEW_MAX_HEIGHT = contentWidth.dialog - spacing['2xl'];
const SINGLE_PREVIEW_MIN_SIZE = contentWidth.dialog / 2;
const MEDIA_COLUMNS = 3;
const CONFIRMATION_ICON_SIZE = 22;
const CONFIRMATION_SEND_ICON_SIZE = 18;

function FileKindIcon({ kind }: { kind: ComposerMediaKind | null }) {
  const c = useThemeColors();
  if (kind === 'image') return <Gallery size={CONFIRMATION_ICON_SIZE} color={c.accent} />;
  if (kind === 'video') {
    return <VideoFramePlayHorizontal size={CONFIRMATION_ICON_SIZE} color={c.accent} />;
  }
  if (kind === 'audio') return <MusicNote size={CONFIRMATION_ICON_SIZE} color={c.accent} />;
  return <FileText size={CONFIRMATION_ICON_SIZE} color={c.accent} />;
}

function usePreviewUri(source: AttachmentConfirmationFile['source']) {
  const browserFile = source.kind === 'browser' ? source.file : null;
  const [objectUrl, setObjectUrl] = useState<{ file: BrowserFile; uri: string } | null>(null);

  useEffect(() => {
    if (!browserFile || typeof URL === 'undefined') return;
    const uri = URL.createObjectURL(browserFile);
    let active = true;
    const frame = requestAnimationFrame(() => {
      if (active) setObjectUrl({ file: browserFile, uri });
    });
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      URL.revokeObjectURL(uri);
    };
  }, [browserFile]);

  if (source.kind === 'uri') return source.uri;
  return objectUrl?.file === source.file ? objectUrl.uri : null;
}

function AttachmentImagePreview({
  item,
  contentFit,
  onImageDimensions,
}: {
  item: AttachmentConfirmationFile;
  contentFit: 'cover' | 'contain';
  onImageDimensions: (width: number, height: number) => void;
}) {
  const uri = usePreviewUri(item.source);
  return uri ? (
    <Image
      source={{ uri }}
      contentFit={contentFit}
      onLoad={({ source }) => onImageDimensions(source.width, source.height)}
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
    />
  ) : null;
}

function VideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.muted = true;
  });
  return (
    <VideoView
      player={player}
      nativeControls={false}
      contentFit="cover"
      pointerEvents="none"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
    />
  );
}

function AttachmentVideoPreview({ item }: { item: AttachmentConfirmationFile }) {
  const uri = usePreviewUri(item.source);
  return uri ? <VideoPreview uri={uri} /> : null;
}

function MediaGridCell({
  item,
  width,
  height,
  onRemove,
  onImageDimensions,
}: {
  item: AttachmentConfirmationFile;
  width: number;
  height: number;
  onRemove: () => void;
  onImageDimensions: (width: number, height: number) => void;
}) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const kind = composerMediaKind(item);
  return (
    <View
      style={{
        width,
        height,
        borderRadius: radius.md,
        overflow: 'hidden',
        backgroundColor: c.surfaceMuted,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {kind !== 'image' && kind !== 'video' ? <FileKindIcon kind={kind} /> : null}
      {kind === 'image' ? (
        <AttachmentImagePreview
          item={item}
          contentFit="contain"
          onImageDimensions={onImageDimensions}
        />
      ) : null}
      {kind === 'video' ? (
        <>
          <AttachmentVideoPreview item={item} />
          <View
            style={{
              position: 'absolute',
              width: spacing['2xl'],
              height: spacing['2xl'],
              borderRadius: radius.full,
              backgroundColor: c.overlay,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Play size={spacing.lg} color={c.onOverlay} fill={c.onOverlay} />
          </View>
        </>
      ) : null}
      <IconButton
        variant="surface"
        size={spacing['2xl']}
        style={{ position: 'absolute', top: spacing.xs, end: spacing.xs }}
        icon={<Trash size={spacing.lg} color={c.danger} />}
        onPress={onRemove}
        accessibilityLabel={t('attach.remove_file', {
          name: item.name ?? t('attach.unnamed_file'),
        })}
      />
    </View>
  );
}

function MediaGrid({
  files,
  onRemoveFile,
  onImageDimensions,
}: Pick<ContentProps, 'files' | 'onRemoveFile' | 'onImageDimensions'>) {
  const { width } = useWindowDimensions();
  const surfaceWidth = Math.min(
    contentWidth.compactSheet,
    width - (IS_ELECTRON ? spacing.xl * 2 : 0),
  );
  const availableWidth = Math.max(
    spacing['3xl'],
    surfaceWidth - spacing.lg * 2,
  );
  const columns = Math.min(MEDIA_COLUMNS, files.length);
  const single = columns === 1;
  const first = files[0];
  const singleAspect = single && first?.width && first.height ? first.width / first.height : 1;
  const cellWidth = single
    ? availableWidth
    : (availableWidth - spacing.sm * (columns - 1)) / columns;
  const cellHeight = single
    ? Math.max(SINGLE_PREVIEW_MIN_SIZE, Math.min(PREVIEW_MAX_HEIGHT, cellWidth / singleAspect))
    : cellWidth;

  return (
    <View
      style={{
        width: availableWidth,
        alignSelf: 'center',
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.sm,
      }}
    >
      {files.map((item, index) => (
        <MediaGridCell
          key={`${item.name ?? item.mime}:${item.size ?? 0}:${index}`}
          item={item}
          width={cellWidth}
          height={cellHeight}
          onRemove={() => onRemoveFile(index)}
          onImageDimensions={(imageWidth, imageHeight) =>
            onImageDimensions(index, imageWidth, imageHeight)
          }
        />
      ))}
    </View>
  );
}

function FileListIcon({
  item,
  onImageDimensions,
}: {
  item: AttachmentConfirmationFile;
  onImageDimensions: (width: number, height: number) => void;
}) {
  const c = useThemeColors();
  const kind = composerMediaKind(item);
  if (kind !== 'image' && kind !== 'video') return <FileKindIcon kind={kind} />;
  return (
    <View
      style={{
        width: spacing['2xl'] - spacing.xs,
        height: spacing['2xl'] - spacing.xs,
        borderRadius: radius.xs,
        overflow: 'hidden',
        backgroundColor: c.surfaceMuted,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {kind === 'image' ? (
        <AttachmentImagePreview
          item={item}
          contentFit="cover"
          onImageDimensions={onImageDimensions}
        />
      ) : (
        <AttachmentVideoPreview item={item} />
      )}
    </View>
  );
}

function FileList({
  files,
  onRemoveFile,
  onImageDimensions,
}: Pick<ContentProps, 'files' | 'onRemoveFile' | 'onImageDimensions'>) {
  const { t } = useTranslation();
  const c = useThemeColors();
  return (
    <View>
      {files.map((item, index) => (
        <ListRow
          key={`${item.name ?? item.mime}:${item.size ?? 0}:${index}`}
          variant="plain"
          icon={
            <FileListIcon
              item={item}
              onImageDimensions={(width, height) => onImageDimensions(index, width, height)}
            />
          }
          title={item.name ?? t('attach.unnamed_file')}
          subtitle={item.size == null ? undefined : (formatFileSize(item.size) ?? undefined)}
          trailing={
            <IconButton
              variant="plain"
              size={spacing['2xl']}
              icon={<Trash size={spacing.lg} color={c.danger} />}
              onPress={() => onRemoveFile(index)}
              accessibilityLabel={t('attach.remove_file', {
                name: item.name ?? t('attach.unnamed_file'),
              })}
            />
          }
        />
      ))}
    </View>
  );
}

/** Shared attachment preview and quality controls for every picker and platform. */
export function AttachmentSendConfirmContent({
  files,
  imageQuality,
  onImageQualityChange,
  message,
  onMessageChange,
  onSubmit,
  sendDisabled,
  inputBackgroundColor,
  onRemoveFile,
  onImageDimensions,
}: ContentProps) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const directionalIconStyle = useDirectionalIconStyle();
  const allMedia = useMemo(
    () => files.length > 0 && files.every((file) => composerMediaKind(file) != null),
    [files],
  );
  const hasImage = files.some((file) => composerMediaKind(file) === 'image');

  return (
    <View style={{ gap: spacing.lg }}>
      {allMedia ? (
        <MediaGrid
          files={files}
          onRemoveFile={onRemoveFile}
          onImageDimensions={onImageDimensions}
        />
      ) : (
        <FileList
          files={files}
          onRemoveFile={onRemoveFile}
          onImageDimensions={onImageDimensions}
        />
      )}
      {hasImage ? (
        <View style={{ paddingHorizontal: spacing.sm }}>
          <ListRow
            variant="plain"
            icon={<Gallery size={CONFIRMATION_ICON_SIZE} color={c.textMuted} />}
            title={t('attach.image_quality')}
            value={t(
              imageQuality === 'optimized'
                ? 'attach.quality_optimized'
                : 'attach.quality_original',
            )}
            onPress={() =>
              onImageQualityChange(imageQuality === 'optimized' ? 'original' : 'optimized')
            }
          />
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <View
          style={{
            flex: 1,
            minHeight: uiDensity.composerActionSize,
            paddingHorizontal: spacing.lg,
            borderRadius: radius.xl,
            backgroundColor: inputBackgroundColor,
            justifyContent: 'center',
          }}
        >
          <TextInput
            value={message}
            onChangeText={onMessageChange}
            onSubmitEditing={onSubmit}
            placeholder={t('attach.add_message')}
            placeholderTextColor={c.textMuted}
            returnKeyType="send"
            maxLength={4096}
            style={{
              color: c.text,
              fontSize: typography.body.fontSize,
              lineHeight: IS_ELECTRON ? typography.body.lineHeight : undefined,
              fontFamily: typography.body.fontFamily,
              paddingVertical: 0,
            }}
          />
        </View>
        <IconButton
          variant="accent"
          size={uiDensity.composerActionSize}
          disabled={sendDisabled}
          onPress={onSubmit}
          icon={
            <Send
              size={CONFIRMATION_SEND_ICON_SIZE}
              color={sendDisabled ? c.textMuted : c.accentForeground}
              style={directionalIconStyle}
            />
          }
          accessibilityLabel={t('attach.send')}
        />
      </View>
    </View>
  );
}

function ConfirmationHeader({ title, onClose }: { title: string; onClose: () => void }) {
  const { t } = useTranslation();
  const c = useThemeColors();
  return (
    <View
      style={{
        minHeight: uiDensity.iconButtonSize,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: uiDensity.iconButtonSize + spacing.sm,
      }}
    >
      <IconButton
        variant="plain"
        size={uiDensity.iconButtonSize}
        onPress={onClose}
        style={{ position: 'absolute', start: 0 }}
        icon={
          <X strokeWidth={iconStrokeWidth.default} size={CONFIRMATION_ICON_SIZE} color={c.text} />
        }
        accessibilityLabel={t('common.close')}
      />
      <AppText variant="subtitle" align="center" numberOfLines={1}>
        {title}
      </AppText>
    </View>
  );
}

/** One confirmation flow with platform-specific dialog/sheet chrome. */
export function AttachmentSendConfirmation({
  visible,
  files,
  onClose,
  onClosed,
  onConfirm,
  onRemoveFile,
  onImageDimensions,
}: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const { height } = useWindowDimensions();
  const [imageQuality, setImageQuality] = useState<ImageSendQuality>(
    DEFAULT_IMAGE_SEND_QUALITY,
  );
  const [message, setMessage] = useState('');
  if (files.length === 0) return null;

  const title =
    files.length === 1
      ? t('attach.send_file_title')
      : t('attach.send_files_title', { count: files.length });
  const imageDimensionsReady = files.every(
    (file) => composerMediaKind(file) !== 'image' || (!!file.width && !!file.height),
  );
  const confirm = () => {
    if (imageDimensionsReady) onConfirm(imageQuality, message.trim());
  };
  const renderContent = (inputBackgroundColor: string) => (
    <AttachmentSendConfirmContent
      files={files}
      imageQuality={imageQuality}
      onImageQualityChange={setImageQuality}
      message={message}
      onMessageChange={setMessage}
      onSubmit={confirm}
      sendDisabled={!imageDimensionsReady}
      inputBackgroundColor={inputBackgroundColor}
      onRemoveFile={onRemoveFile}
      onImageDimensions={onImageDimensions}
    />
  );

  if (IS_ELECTRON) {
    return (
      <DialogSurface
        visible={visible}
        maxWidth={contentWidth.compactSheet}
        onClose={onClose}
        onClosed={onClosed}
        accessibilityLabel={t('common.close')}
      >
        <ConfirmationHeader title={title} onClose={onClose} />
        <ScrollView
          style={{ maxHeight: Math.min(height * 0.65, contentWidth.compactSheet) }}
          contentContainerStyle={{ gap: spacing.lg }}
        >
          {renderContent(c.surfaceMuted)}
        </ScrollView>
      </DialogSurface>
    );
  }

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      onClosed={onClosed}
      maxWidth={contentWidth.compactSheet}
      title={title}
      contentStyle={{ gap: spacing.lg }}
    >
      {renderContent(c.surfaceElevated)}
    </BottomSheet>
  );
}
