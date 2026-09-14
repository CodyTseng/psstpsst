import { Image } from 'expo-image';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  StyleSheet,
  View,
} from 'react-native';
import { releaseCapture } from 'react-native-view-shot';

import { AppFormScrollView } from '@/components/common/AppFormScrollView';
import { AppButton } from '@/components/common/AppButton';
import { AppInput } from '@/components/common/AppInput';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { InvalidRouteRedirect } from '@/components/navigation/InvalidRouteRedirect';
import Plus from 'lucide-react-native/icons/plus';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import {
  SquareImageCropper,
  type SquareImageCropperHandle,
} from '@/components/emoji/SquareImageCropper';
import { useScrolled } from '@/hooks/use-scrolled';
import { useCustomEmojis } from '@/hooks/use-custom-emojis';
import { isAnimatedGifImage } from '@/lib/image/animated-image';
import { optionalRouteTextParam } from '@/lib/navigation/route-params';
import { IS_ELECTRON } from '@/lib/platform';
import {
  isValidEmojiShortcode,
  MAX_EMOJI_SHORTCODE_LENGTH,
  normalizeEmojiShortcode,
} from '@/lib/nostr/custom-emoji';
import { platform } from '@/platform';
import {
  cancelEmojiDraftRequest,
  completeEmojiDraftRequest,
  hasEmojiDraftRequest,
  hasEmojiDraftShortcode,
} from '@/services/emoji/custom-emoji-image-handoff';
import { uploadCustomEmojiImage } from '@/services/emoji/custom-emoji-image.service';
import { addStandaloneEmoji } from '@/services/emoji/custom-emoji.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { iconStrokeWidth } from '@/theme/icons';
import { spacing, useThemeColors } from '@/theme';

export default function AddCustomEmojiScreen() {
  const { scrolled, scrollProps } = useScrolled();
  const { t } = useTranslation();
  const c = useThemeColors();
  const titleClearance = useScreenHeaderClearance();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{
    uri?: string | string[];
    width?: string | string[];
    height?: string | string[];
    mime?: string | string[];
    fileName?: string | string[];
    draftRequestId?: string | string[];
  }>();
  const sourceUriParam = optionalRouteTextParam(params.uri, 8_192);
  const sourceMimeParam = optionalRouteTextParam(params.mime, 128);
  const sourceFileNameParam = optionalRouteTextParam(params.fileName, 256);
  const draftRequestIdParam = optionalRouteTextParam(params.draftRequestId, 128);
  const widthParam = optionalRouteTextParam(params.width, 32);
  const heightParam = optionalRouteTextParam(params.height, 32);
  const invalidRoute =
    sourceUriParam === null ||
    sourceMimeParam === null ||
    sourceFileNameParam === null ||
    draftRequestIdParam === null ||
    widthParam === null ||
    heightParam === null;
  const sourceUri = sourceUriParam ?? undefined;
  const sourceMime = sourceMimeParam ?? undefined;
  const sourceFileName = sourceFileNameParam ?? undefined;
  const draftRequestId = draftRequestIdParam ?? undefined;
  const accountPubkey = useActiveAccount((state) => state.activePubkey);
  const cropperRef = useRef<SquareImageCropperHandle>(null);
  const collection = useCustomEmojis(draftRequestId ? null : accountPubkey);
  const width = Number(widthParam);
  const height = Number(heightParam);
  const sourceValid =
    !!sourceUri &&
    Number.isFinite(width) &&
    width > 0 &&
    Number.isFinite(height) &&
    height > 0;
  const animatedGif = isAnimatedGifImage(
    sourceMime,
    sourceFileName,
    sourceUri,
  );
  const [shortcode, setShortcode] = useState('');
  const [cropReady, setCropReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveCompleted, setSaveCompleted] = useState(false);
  const normalized = normalizeEmojiShortcode(shortcode);
  const valid = isValidEmojiShortcode(normalized);
  const draftRequestValid =
    !draftRequestId || hasEmojiDraftRequest(draftRequestId);
  const duplicate =
    !saving &&
    (draftRequestId
      ? hasEmojiDraftShortcode(draftRequestId, normalized)
      : collection.standalone.some(
          (emoji) => emoji.shortcode.toLowerCase() === normalized.toLowerCase(),
        ));

  usePreventRemove(saving && !saveCompleted, () => undefined);

  useEffect(() => {
    return navigation.addListener('beforeRemove', () => {
      if (draftRequestId) {
        cancelEmojiDraftRequest(draftRequestId);
      }
    });
  }, [draftRequestId, navigation]);

  function beginSave() {
    if (
      !accountPubkey ||
      !sourceValid ||
      !draftRequestValid ||
      (!animatedGif && !cropReady) ||
      saving
    ) {
      return;
    }
    if (!valid) {
      void platform.confirmationDialog.notify({
        title: t('emoji.invalid_shortcode'),
        okLabel: t('common.ok'),
      });
      return;
    }
    if (duplicate) {
      void platform.confirmationDialog.notify({
        title: t(
          draftRequestId
            ? 'emoji.duplicate_shortcode'
            : 'emoji.duplicate_standalone_shortcode',
        ),
        okLabel: t('common.ok'),
      });
      return;
    }
    setSaving(true);
    setTimeout(() => {
      const save = (async () => {
        let capturedUri: string | undefined;
        try {
          if (
            draftRequestId &&
            !hasEmojiDraftRequest(draftRequestId)
          ) {
            throw new Error('Emoji draft request is no longer available.');
          }
          const emoji = animatedGif
            ? await uploadCustomEmojiImage({
                accountPubkey,
                shortcode: normalized,
                fileUri: sourceUri!,
                mime: sourceMime || 'image/gif',
                metadataStripped: false,
                preserveSourceBytes: true,
              })
            : await (async () => {
                capturedUri = await cropperRef.current!.capture();
                return uploadCustomEmojiImage({
                  accountPubkey,
                  shortcode: normalized,
                  fileUri: capturedUri,
                  mime: 'image/png',
                  metadataStripped: true,
                  preserveSourceBytes: false,
                });
              })();
          if (draftRequestId) {
            const completed = completeEmojiDraftRequest(
              draftRequestId,
              emoji,
            );
            if (!completed) {
              throw new Error('Emoji draft request is no longer available.');
            }
            return;
          }
          await addStandaloneEmoji(accountPubkey, emoji);
        } finally {
          if (capturedUri) releaseCapture(capturedUri);
        }
      })();
      void save
        .then(() => {
          setSaveCompleted(true);
          setTimeout(() => router.back(), 0);
        })
        .catch((error: unknown) => {
          console.error('[custom-emoji] Failed to capture or upload image.', error);
          void platform.confirmationDialog.notify({
            title: t('emoji.add_custom_failed'),
            okLabel: t('common.ok'),
          });
          setSaving(false);
        });
    }, 0);
  }

  if (invalidRoute) return <InvalidRouteRedirect />;

  return (
    <AppScreen edges={[]}>
      <AppFormScrollView
        {...scrollProps}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: spacing.lg,
          paddingTop: titleClearance + spacing.lg,
          paddingBottom: spacing['3xl'],
          gap: spacing.xl,
        }}
      >
        {sourceValid && draftRequestValid ? (
          <>
            <View style={{ alignItems: 'center', gap: spacing.sm }}>
              {animatedGif ? (
                <View
                  style={{
                    width: '100%',
                    maxWidth: 420,
                    aspectRatio: 1,
                    alignSelf: 'center',
                    overflow: 'hidden',
                    backgroundColor: c.surfaceMuted,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: c.border,
                  }}
                >
                  <Image
                    source={{ uri: sourceUri! }}
                    style={StyleSheet.absoluteFill}
                    contentFit="contain"
                    cachePolicy="memory"
                    recyclingKey={sourceUri!}
                    autoplay
                  />
                </View>
              ) : (
                <SquareImageCropper
                  key={sourceUri}
                  ref={cropperRef}
                  uri={sourceUri!}
                  sourceWidth={width}
                  sourceHeight={height}
                  onReadyChange={setCropReady}
                />
              )}
              <AppText variant="caption" tone="muted" align="center">
                {t(
                  animatedGif
                    ? 'emoji.gif_preserved_hint'
                    : IS_ELECTRON
                      ? 'emoji.crop_hint_desktop'
                      : 'emoji.crop_hint',
                )}
              </AppText>
            </View>

            <AppInput
              label={t('emoji.shortcode_label')}
              description={t('emoji.shortcode_hint')}
              error={
                duplicate
                  ? t(
                      draftRequestId
                        ? 'emoji.duplicate_shortcode'
                        : 'emoji.duplicate_standalone_shortcode',
                    )
                  : undefined
              }
              value={shortcode}
              onChangeText={(value) =>
                setShortcode(
                  value
                    .replace(/[^A-Za-z0-9_-]/g, '')
                    .slice(0, MAX_EMOJI_SHORTCODE_LENGTH),
                )
              }
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={MAX_EMOJI_SHORTCODE_LENGTH}
              placeholder={t('emoji.shortcode_placeholder')}
              invalid={shortcode.length > 0 && !valid}
              editable={!saving && draftRequestValid}
            />

            <AppButton
              label={saving ? t('attach.uploading') : t('emoji.add_custom_emoji')}
              variant="primary"
              accessibilityState={{ busy: saving }}
              disabled={
                saving ||
                !draftRequestValid ||
                (!animatedGif && !cropReady) ||
                !valid ||
                duplicate
              }
              iconLeft={(
                <View
                  style={{
                    width: spacing.lg,
                    height: spacing.lg,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {saving ? (
                    <ActivityIndicator size={spacing.lg} color={c.accentForeground} />
                  ) : (
                    <Plus strokeWidth={iconStrokeWidth.default} size={spacing.lg} color={c.accentForeground} />
                  )}
                </View>
              )}
              onPress={beginSave}
            />
          </>
        ) : (
          <View style={{ alignItems: 'center', gap: spacing.md }}>
            <AppText tone="muted" align="center">
              {t('emoji.add_custom_failed')}
            </AppText>
            <AppButton
              label={t('common.back')}
              variant="secondary"
              fullWidth={false}
              onPress={() => router.back()}
            />
          </View>
        )}
      </AppFormScrollView>
      <ScreenHeader
        bordered={scrolled}
        title={t('emoji.name_custom_emoji')}
        onBack={() => {
          if (!saving) {
            if (draftRequestId) {
              cancelEmojiDraftRequest(draftRequestId);
            }
            router.back();
          }
        }}
      />
    </AppScreen>
  );
}
