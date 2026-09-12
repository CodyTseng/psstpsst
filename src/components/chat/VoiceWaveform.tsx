import { memo, useState } from 'react';
import { type LayoutChangeEvent, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';

import { downsampleWaveform } from '@/lib/audio/voice';

type Props = {
  /** Amplitude bars, integers 0–100. */
  bars: number[];
  /** Playback position as a fraction 0–1. */
  progress: number;
  /** Color for the played (left) portion. */
  playedColor: string;
  /** Color for the unplayed (right) portion. */
  trackColor: string;
  /** When set, dragging/tapping the waveform reports the touched fraction
   * (0–1) so the caller can seek. Omit for a static (display-only) waveform. */
  onSeek?: (fraction: number) => void;
  /** Row height; bar heights scale within it. Default 28. */
  height?: number;
};

const MIN_BAR = 3;
const BAR_GAP = 2;
// Aim for at least this bar width: too many thin (sub-pixel) bars antialias into
// a fuzzy smear, so the stored waveform is downsampled to however many crisp
// bars fit the measured width.
const TARGET_BAR_W = 3;

/**
 * The single voice-message waveform primitive — a row of amplitude bars whose
 * played portion fills left-to-right. Shared by the audio bubble
 * ({@link AttachmentAudio}) and the recorder preview ({@link VoiceRecorderBar})
 * so a voice waveform looks identical wherever it appears (DESIGN §8).
 *
 * The played fill is drawn **inside each bar** (a coloured child clipped to the
 * fraction of that bar that has played) rather than as a second full-width
 * overlay — so the two colours can never drift apart, and the boundary bar fills
 * partially, giving a smooth sub-bar advance instead of a bar-at-a-time snap.
 */
export const VoiceWaveform = memo(function VoiceWaveform({
  bars,
  progress,
  playedColor,
  trackColor,
  onSeek,
  height = 28,
}: Props) {
  // Measured row width: drives the crisp bar count and the seek math.
  const [boxW, setBoxW] = useState(0);
  const width = useSharedValue(0);

  function onLayout(e: LayoutChangeEvent) {
    const w = e.nativeEvent.layout.width;
    width.value = w;
    setBoxW(w);
  }

  // Downsample to however many crisp bars fit the measured width.
  const display =
    boxW <= 0 || bars.length === 0
      ? bars
      : (() => {
          const fit = Math.max(1, Math.floor((boxW + BAR_GAP) / (TARGET_BAR_W + BAR_GAP)));
          return bars.length > fit ? downsampleWaveform(bars, fit) : bars;
        })();

  const n = display.length;
  const barW = boxW > 0 && n > 0 ? (boxW - BAR_GAP * (n - 1)) / n : 0;
  const p = progress < 0 ? 0 : progress > 1 ? 1 : progress;

  const row = (
    <View
      onLayout={onLayout}
      style={{ flex: 1, height, flexDirection: 'row', alignItems: 'flex-end' }}
    >
      {barW > 0
        ? display.map((b, i) => {
            const h = MIN_BAR + (Math.max(0, Math.min(100, b)) / 100) * (height - MIN_BAR);
            // Fraction of this bar that has been played (0…1); the boundary bar
            // fills partially, so the edge advances smoothly within a bar.
            const fill = Math.max(0, Math.min(1, p * n - i));
            return (
              <View
                key={i}
                style={{
                  width: barW,
                  marginRight: i < n - 1 ? BAR_GAP : 0,
                  height: h,
                  borderRadius: 1.5,
                  backgroundColor: trackColor,
                  overflow: 'hidden',
                }}
              >
                {fill > 0 ? (
                  <View
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: barW * fill,
                      backgroundColor: playedColor,
                    }}
                  />
                ) : null}
              </View>
            );
          })
        : null}
    </View>
  );

  if (!onSeek) return row;

  // minDistance(0) makes a plain touch seek immediately (tap-to-seek), and the
  // same gesture keeps reporting while the finger drags (scrub).
  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      'worklet';
      if (width.value > 0) runOnJS(onSeek)(clampUnit(e.x / width.value));
    })
    .onUpdate((e) => {
      'worklet';
      if (width.value > 0) runOnJS(onSeek)(clampUnit(e.x / width.value));
    });

  return <GestureDetector gesture={pan}>{row}</GestureDetector>;
});

function clampUnit(v: number): number {
  'worklet';
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
