import { Image } from 'expo-image';
import Minus from 'lucide-react-native/icons/minus';
import Plus from 'lucide-react-native/icons/plus';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { IconButton } from '@/components/common/IconButton';
import { IS_ELECTRON } from '@/lib/platform';
import { iconStrokeWidth } from '@/theme/icons';
import { spacing, useThemeColors } from '@/theme';

import { captureSquareImage } from './square-image-capture';

const MAX_SCALE = 6;
const ZOOM_STEP = 1.25;
export const CUSTOM_EMOJI_OUTPUT_SIZE = 512;

type Props = {
  uri: string;
  sourceWidth: number;
  sourceHeight: number;
  onReadyChange?: (ready: boolean) => void;
};

export type SquareImageCropperHandle = {
  capture: () => Promise<string>;
};

function clamp(value: number, min: number, max: number): number {
  'worklet';
  return Math.min(max, Math.max(min, value));
}

function maxOffset(baseExtent: number, scale: number, viewportSize: number): number {
  'worklet';
  return Math.max(0, (baseExtent * scale - viewportSize) / 2);
}

/** A square framing viewport whose image transform stays on the UI thread. */
export const SquareImageCropper = forwardRef<SquareImageCropperHandle, Props>(
  function SquareImageCropper(
    { uri, sourceWidth, sourceHeight, onReadyChange },
    forwardedRef,
  ) {
    const c = useThemeColors();
    const { t } = useTranslation();
    const captureTargetRef = useRef<View>(null);
    const [viewportSize, setViewportSize] = useState(0);
    const [imageLoaded, setImageLoaded] = useState(false);
    const coverScale = Math.max(
      sourceWidth / sourceHeight,
      sourceHeight / sourceWidth,
    );
    const scale = useSharedValue(coverScale);
    const translationX = useSharedValue(0);
    const translationY = useSharedValue(0);
    const startScale = useSharedValue(coverScale);
    const startTranslationX = useSharedValue(0);
    const startTranslationY = useSharedValue(0);

    const baseImageScale = viewportSize
      ? Math.min(viewportSize / sourceWidth, viewportSize / sourceHeight)
      : 0;
    const baseWidth = sourceWidth * baseImageScale;
    const baseHeight = sourceHeight * baseImageScale;
    const maximumScale = coverScale * MAX_SCALE;
    const [zoomLimits, setZoomLimits] = useState({
      atMinimum: coverScale === 1,
      atMaximum: false,
    });

    const updateScale = useCallback(
      (nextScale: number) => {
        'worklet';
        scale.value = clamp(nextScale, 1, maximumScale);
        const limitX = maxOffset(baseWidth, scale.value, viewportSize);
        const limitY = maxOffset(baseHeight, scale.value, viewportSize);
        translationX.value = clamp(translationX.value, -limitX, limitX);
        translationY.value = clamp(translationY.value, -limitY, limitY);
      },
      [baseHeight, baseWidth, maximumScale, scale, translationX, translationY, viewportSize],
    );

    useAnimatedReaction(
      () => ({ atMinimum: scale.value <= 1, atMaximum: scale.value >= maximumScale }),
      (next, previous) => {
        if (
          IS_ELECTRON &&
          (next.atMinimum !== previous?.atMinimum || next.atMaximum !== previous?.atMaximum)
        ) {
          scheduleOnRN(setZoomLimits, next);
        }
      },
      [maximumScale],
    );

    useImperativeHandle(
      forwardedRef,
      () => ({
        capture: async () => {
          if (!captureTargetRef.current || !imageLoaded || !viewportSize) {
            throw new Error('Custom emoji preview is not ready.');
          }
          const captured = await captureSquareImage(captureTargetRef.current, {
            uri,
            viewportSize,
            outputSize: CUSTOM_EMOJI_OUTPUT_SIZE,
            imageWidth: baseWidth * scale.value,
            imageHeight: baseHeight * scale.value,
            translationX: translationX.value,
            translationY: translationY.value,
          });
          if (typeof captured !== 'string' || captured.length === 0) {
            throw new Error('Custom emoji capture returned no file path.');
          }
          return captured;
        },
      }),
      [baseHeight, baseWidth, imageLoaded, scale, translationX, translationY, uri, viewportSize],
    );

    useEffect(() => {
      scale.value = coverScale;
      translationX.value = 0;
      translationY.value = 0;
    }, [coverScale, scale, translationX, translationY, uri, viewportSize]);

    useEffect(() => {
      onReadyChange?.(imageLoaded && viewportSize > 0);
    }, [imageLoaded, onReadyChange, viewportSize]);

    const gesture = useMemo(() => {
      const pan = Gesture.Pan()
        .activeCursor('grabbing')
        .onStart(() => {
          'worklet';
          startTranslationX.value = translationX.value;
          startTranslationY.value = translationY.value;
        })
        .onUpdate((event) => {
          'worklet';
          const limitX = maxOffset(baseWidth, scale.value, viewportSize);
          const limitY = maxOffset(baseHeight, scale.value, viewportSize);
          translationX.value = clamp(
            startTranslationX.value + event.translationX,
            -limitX,
            limitX,
          );
          translationY.value = clamp(
            startTranslationY.value + event.translationY,
            -limitY,
            limitY,
          );
        });

      const pinch = Gesture.Pinch()
        .onStart(() => {
          'worklet';
          startScale.value = scale.value;
        })
        .onUpdate((event) => {
          'worklet';
          updateScale(startScale.value * event.scale);
        });

      return Gesture.Simultaneous(pan, pinch);
    }, [
      baseHeight,
      baseWidth,
      scale,
      startScale,
      startTranslationX,
      startTranslationY,
      translationX,
      translationY,
      updateScale,
      viewportSize,
    ]);

    const translationStyle = useAnimatedStyle(() => ({
      transform: [
        { translateX: translationX.value },
        { translateY: translationY.value },
      ],
    }));
    const scaleStyle = useAnimatedStyle(() => ({
      transform: [{ scale: scale.value }],
    }));

    return (
      <View style={{ width: '100%', alignItems: 'center', gap: spacing.sm }}>
        <View
          onLayout={(event) => setViewportSize(event.nativeEvent.layout.width)}
          style={{
            width: '100%',
            maxWidth: 420,
            aspectRatio: 1,
            alignSelf: 'center',
            overflow: 'hidden',
            backgroundColor: c.surfaceMuted,
          }}
        >
          {viewportSize > 0 ? (
            <GestureDetector gesture={gesture} touchAction="none" userSelect="none">
              <View
                ref={captureTargetRef}
                collapsable={false}
                style={[
                  StyleSheet.absoluteFill,
                  { backgroundColor: 'transparent' },
                  // React Native's cursor type excludes this supported web value.
                  IS_ELECTRON && ({ cursor: 'grab' } as unknown as ViewStyle),
                ]}
              >
                <Animated.View
                  style={[
                    {
                      position: 'absolute',
                      left: (viewportSize - baseWidth) / 2,
                      top: (viewportSize - baseHeight) / 2,
                      width: baseWidth,
                      height: baseHeight,
                    },
                    translationStyle,
                  ]}
                >
                  <Animated.View style={[StyleSheet.absoluteFill, scaleStyle]}>
                    <Image
                      source={{ uri }}
                      draggable={false}
                      style={StyleSheet.absoluteFill}
                      contentFit="fill"
                      cachePolicy="memory"
                      recyclingKey={uri}
                      onLoad={() => setImageLoaded(true)}
                    />
                  </Animated.View>
                </Animated.View>
              </View>
            </GestureDetector>
          ) : null}
          <View
            style={[
              StyleSheet.absoluteFill,
              { borderWidth: StyleSheet.hairlineWidth, borderColor: c.border },
              { pointerEvents: 'none' },
            ]}
          />
        </View>
        {IS_ELECTRON ? (
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <IconButton
              icon={<Minus strokeWidth={iconStrokeWidth.default} size={spacing.xl} color={c.text} />}
              variant="secondary"
              accessibilityLabel={t('emoji.zoom_out')}
              disabled={!imageLoaded || !viewportSize || zoomLimits.atMinimum}
              onPress={() => updateScale(scale.value / ZOOM_STEP)}
            />
            <IconButton
              icon={<Plus strokeWidth={iconStrokeWidth.default} size={spacing.xl} color={c.text} />}
              variant="secondary"
              accessibilityLabel={t('emoji.zoom_in')}
              disabled={!imageLoaded || !viewportSize || zoomLimits.atMaximum}
              onPress={() => updateScale(scale.value * ZOOM_STEP)}
            />
          </View>
        ) : null}
      </View>
    );
  },
);
