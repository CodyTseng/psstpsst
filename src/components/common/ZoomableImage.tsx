import { Image } from 'expo-image';
import { useEffect, useImperativeHandle, useMemo, useState, type Ref } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { IS_ELECTRON } from '@/lib/platform';
import { manipulationTiming } from '@/theme/motion';
import { ImagePointerPan } from './ImagePointerPan';

export const IMAGE_MAX_SCALE = 4;
const ZOOM_STEP = 1.25;
/** Distance (px) a not-zoomed drag must travel before release dismisses. */
const DISMISS_THRESHOLD = 120;

export type ZoomableImageHandle = {
  zoomIn: () => void;
  zoomOut: () => void;
};

type Props = {
  ref?: Ref<ZoomableImageHandle>;
  onScaleChange?: (scale: number) => void;
  uri: string;
  /** Stable native cache identity when the remote source publishes a hash. */
  cacheKey?: string;
  /** A blurred preview shown until the full image decodes (ThumbHash). */
  thumbhash?: string;
  blurhash?: string;
  /** Drag direction that dismisses when not zoomed: `both` (avatar lightbox) or
   * `vertical` only (inside a horizontal pager — horizontal drags page instead). */
  dismissAxis?: 'both' | 'vertical';
  onRequestClose: () => void;
  /** Fired when the zoom crosses 1× ⇄ >1×, so a parent pager can disable its
   * horizontal scroll while zoomed (pan then moves within the image). */
  onZoomedChange?: (zoomed: boolean) => void;
  /** 0→1 dismiss-drag fraction, so a parent can fade its backdrop in step. */
  onDragProgress?: (progress: number) => void;
};

/**
 * One pinch-zoomable, drag-to-dismiss image. The shared core of every full-screen
 * media surface: the single-image lightbox (`MediaViewer` single mode) and each
 * image page of the conversation media pager. Gestures mirror a standard lightbox
 * — pinch to zoom (≤4×), pan when zoomed, double-tap to toggle 1×/2×, single-tap
 * or a far-enough drag to dismiss.
 */
export function ZoomableImage({
  ref,
  onScaleChange,
  uri,
  cacheKey,
  thumbhash,
  blurhash,
  dismissAxis = 'both',
  onRequestClose,
  onZoomedChange,
  onDragProgress,
}: Props) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);
  // Mirrors `scale > 1` for the worklets (`zoomed` shared value) and for the
  // gesture config (`isZoomed` JS state — it rebuilds the pan, see below). The
  // parent is notified so it can gate its horizontal paging while zoomed.
  const zoomed = useSharedValue(false);
  const [currentScale, setCurrentScale] = useState(1);
  const isZoomed = currentScale > 1;

  const setZoomed = (nextScale: number) => {
    const next = nextScale > 1;
    const changed = zoomed.value !== next;
    zoomed.value = next;
    setCurrentScale(nextScale);
    if (changed) onZoomedChange?.(next);
  };
  useEffect(() => {
    onScaleChange?.(currentScale);
  }, [currentScale, onScaleChange]);

  const reportProgress = (p: number) => onDragProgress?.(p);

  function zoomBy(factor: number) {
    const nextScale = Math.min(IMAGE_MAX_SCALE, Math.max(1, savedScale.value * factor));
    // Retarget from the visible frame, even when the previous zoom is in flight.
    const ratio = nextScale / scale.value;
    // Keep the point under the viewport centre fixed until returning to fit.
    tx.value = withTiming(nextScale === 1 ? 0 : tx.value * ratio, manipulationTiming);
    ty.value = withTiming(nextScale === 1 ? 0 : ty.value * ratio, manipulationTiming);
    scale.value = withTiming(nextScale, manipulationTiming);
    savedScale.value = nextScale;
    setZoomed(nextScale);
    reportProgress(0);
  }

  function startPointerPan() {
    cancelAnimation(tx);
    cancelAnimation(ty);
    savedTx.value = tx.value;
    savedTy.value = ty.value;
  }

  function movePointerPan(x: number, y: number) {
    tx.value = savedTx.value + x;
    ty.value = savedTy.value + y;
  }

  function moveWheelPan(deltaX: number, deltaY: number) {
    cancelAnimation(tx);
    cancelAnimation(ty);
    tx.value += deltaX;
    ty.value += deltaY;
    savedTx.value = tx.value;
    savedTy.value = ty.value;
  }

  function zoomWheel(factor: number, originX: number, originY: number) {
    cancelAnimation(scale);
    cancelAnimation(tx);
    cancelAnimation(ty);
    const previousScale = scale.value;
    const nextScale = Math.min(IMAGE_MAX_SCALE, Math.max(1, previousScale * factor));
    if (nextScale === previousScale) return;

    if (nextScale === 1) {
      tx.value = 0;
      ty.value = 0;
    } else {
      const ratio = nextScale / previousScale;
      // Keep the image point beneath the trackpad gesture stationary.
      tx.value = originX + (tx.value - originX) * ratio;
      ty.value = originY + (ty.value - originY) * ratio;
    }
    scale.value = nextScale;
    savedScale.value = nextScale;
    savedTx.value = tx.value;
    savedTy.value = ty.value;
    setZoomed(nextScale);
    reportProgress(0);
  }

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      'worklet';
      scale.value = Math.min(IMAGE_MAX_SCALE, Math.max(1, savedScale.value * e.scale));
    })
    .onEnd(() => {
      'worklet';
      savedScale.value = scale.value;
      const isZoomed = scale.value > 1;
      if (!isZoomed) {
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        savedTx.value = 0;
        savedTy.value = 0;
      }
      runOnJS(setZoomed)(scale.value);
    });

  // Rebuilt when zoom or the dismiss axis changes (always *between* gestures, so
  // safe). The activation thresholds — fixed at construction — are the crux of
  // coexisting with a parent horizontal pager: when not zoomed in `vertical`
  // mode the pan only activates on a dominant-vertical drag (`activeOffsetY`) and
  // bails on a horizontal one (`failOffsetX`), so left/right swipes fall through
  // to the pager and only up/down drives dismiss. When zoomed (paging is
  // disabled by the parent) it's a free 2-D pan to look around; `both` mode
  // (single-image lightbox, no pager) is always a free any-direction drag.
  const pan = useMemo(() => {
    const verticalOnly = dismissAxis === 'vertical' && !isZoomed;
    const g = verticalOnly
      ? Gesture.Pan().activeOffsetY([-15, 15]).failOffsetX([-15, 15])
      : Gesture.Pan();
    return g
      .activeCursor(IS_ELECTRON && isZoomed ? 'grabbing' : 'auto')
      .onStart(() => {
        'worklet';
        cancelAnimation(tx);
        cancelAnimation(ty);
        savedTx.value = tx.value;
        savedTy.value = ty.value;
      })
      .onUpdate((e) => {
        'worklet';
        if (zoomed.value) {
          tx.value = savedTx.value + e.translationX;
          ty.value = savedTy.value + e.translationY;
          return;
        }
        ty.value = e.translationY;
        tx.value = dismissAxis === 'vertical' ? 0 : e.translationX;
        const dist =
          dismissAxis === 'vertical'
            ? Math.abs(ty.value)
            : Math.sqrt(tx.value * tx.value + ty.value * ty.value);
        runOnJS(reportProgress)(Math.min(dist / 300, 1));
      })
      .onEnd((e) => {
        'worklet';
        if (zoomed.value) {
          savedTx.value = tx.value;
          savedTy.value = ty.value;
          return;
        }
        const dist =
          dismissAxis === 'vertical'
            ? Math.abs(ty.value)
            : Math.sqrt(tx.value * tx.value + ty.value * ty.value);
        const speed =
          dismissAxis === 'vertical'
            ? Math.abs(e.velocityY)
            : Math.sqrt(e.velocityX * e.velocityX + e.velocityY * e.velocityY);
        if (dist > DISMISS_THRESHOLD || speed > 1000) {
          runOnJS(onRequestClose)();
        } else {
          tx.value = withSpring(0, { velocity: e.velocityX });
          ty.value = withSpring(0, { velocity: e.velocityY });
          runOnJS(reportProgress)(0);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dismissAxis, isZoomed]);

  const doubleTap = Gesture.Tap()
    // Electron's DOM surface owns both clicks so one double-click toggles once.
    .enabled(!IS_ELECTRON)
    .numberOfTaps(2)
    .onEnd((_e, success) => {
      'worklet';
      if (!success) return;
      const isZoomed = savedScale.value > 1;
      scale.value = withTiming(isZoomed ? 1 : 2, manipulationTiming);
      savedScale.value = isZoomed ? 1 : 2;
      tx.value = withTiming(0, manipulationTiming);
      ty.value = withTiming(0, manipulationTiming);
      savedTx.value = 0;
      savedTy.value = 0;
      runOnJS(setZoomed)(isZoomed ? 1 : 2);
    });

  // Single tap dismisses (standard lightbox) — only when not zoomed, so a stray
  // tap while zoomed doesn't close. Waits for the double-tap to fail.
  const singleTap = Gesture.Tap()
    .enabled(!IS_ELECTRON)
    .numberOfTaps(1)
    .onEnd((_e, success) => {
      'worklet';
      if (success && scale.value <= 1) runOnJS(onRequestClose)();
    });

  // Race pinch/pan against the taps so a drag tracks the finger from its first
  // movement (an Exclusive would make the pan wait for the double-tap to fail).
  const gesture = Gesture.Race(
    Gesture.Simultaneous(pinch, pan),
    Gesture.Exclusive(doubleTap, singleTap),
  );

  const imageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));

  useImperativeHandle(ref, () => ({
    zoomIn: () => zoomBy(ZOOM_STEP),
    zoomOut: () => zoomBy(1 / ZOOM_STEP),
  }));

  return (
    <ImagePointerPan
      enabled={IS_ELECTRON && isZoomed}
      onStart={startPointerPan}
      onMove={movePointerPan}
      onWheelPan={moveWheelPan}
      onWheelZoom={zoomWheel}
      onSingleClick={() => {
        if (savedScale.value <= 1) onRequestClose();
      }}
      onDoubleClick={() => zoomBy((savedScale.value > 1 ? 1 : 2) / savedScale.value)}
    >
      <GestureDetector gesture={gesture} touchAction="none" userSelect="none">
        <View
          collapsable={false}
          style={StyleSheet.absoluteFill}
        >
          <Animated.View style={[StyleSheet.absoluteFill, imageStyle]}>
            <Image
              source={{ uri, cacheKey }}
              placeholder={
                thumbhash ? { thumbhash } : blurhash ? { blurhash } : undefined
              }
              placeholderContentFit="contain"
              style={{ width: '100%', height: '100%' }}
              contentFit="contain"
              // No fade-in transition: a ThumbHash only stores the aspect ratio
              // quantized to sevenths, so the placeholder's contain-fit rect can
              // differ slightly from the real image's — crossfading between the two
              // shows a blurry ghost ring around the sharp image for the duration.
              cachePolicy="memory-disk"
              recyclingKey={cacheKey ?? uri}
              autoplay
              draggable={false}
            />
          </Animated.View>
        </View>
      </GestureDetector>
    </ImagePointerPan>
  );
}
