import { useMemo, useRef, useState } from 'react';
import { type LayoutChangeEvent, PanResponder, View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { FrostedBackdrop } from '@/components/common/FrostedBackdrop';
import { selectionTick } from '@/lib/haptics';
import { radius, useThemeColors } from '@/theme';

/** Vertical inset of the rail pill, shared between its style and the
 * drag-to-index math so the finger's y maps onto the letters, not the padding. */
const RAIL_PADDING_Y = 4;
/** The magnified letter callout shown to the left of the rail while scrubbing. */
const BUBBLE_SIZE = 56;
const BUBBLE_GAP = 12;

type Props = {
  /** Section titles, in list order — one tappable letter each. */
  titles: string[];
  /** Jump the list to this section index. */
  onJump: (index: number) => void;
};

/**
 * The contacts localized jump rail as a single press-and-drag control (like iOS
 * contacts): touching or dragging anywhere on it jumps to the letter under the
 * finger, ticks a selection haptic on each crossing, tints the active letter
 * `accent`, and floats a magnified letter callout to its left so the finger
 * never hides which letter is selected.
 *
 * Volatile drag state (active letter, measured geometry) lives here, local to
 * the rail, so scrubbing never re-renders the contact list behind it. The
 * `PanResponder` is created once (stable handlers) and reads the latest props
 * through refs.
 */
export function ContactIndexRail({ titles, onJump }: Props) {
  const c = useThemeColors();
  const [active, setActive] = useState<number | null>(null);
  const [pill, setPill] = useState({ width: 0, height: 0 });
  const [wrapperHeight, setWrapperHeight] = useState(0);

  // Latest values for the stable PanResponder to read without re-creating it.
  const pillRef = useRef<View>(null);
  const pillHeightRef = useRef(0);
  // The pill's absolute screen top — we map the touch's `pageY` against this,
  // NOT the event's `locationY`: `locationY` is relative to whichever child node
  // was actually touched (a single letter cell, ~16px tall), which would always
  // resolve near the first letter. `pageY` is screen-absolute and stable.
  //
  // This MUST come from `measure()`'s `pageY` output, not `measureInWindow()`'s
  // window-relative `y`: on Android the latter excludes the status bar while the
  // touch's `pageY` includes it, so the two live in different frames and the
  // mismatch shifts every letter downward (tap F, land on L). `measure()`'s
  // `pageY` is the same screen-absolute frame as the touch. (On iOS both agree.)
  const pillTopRef = useRef(0);
  const countRef = useRef(titles.length);
  countRef.current = titles.length;
  const activeRef = useRef(-1);
  const onJumpRef = useRef(onJump);
  onJumpRef.current = onJump;

  const measurePill = () => {
    pillRef.current?.measure((_x, _y, width, height, _pageX, pageY) => {
      pillTopRef.current = pageY;
      pillHeightRef.current = height;
      setPill({ width, height });
    });
  };

  const updateFromY = useRef<(pageY: number) => void>(() => {});
  updateFromY.current = (pageY: number) => {
    const count = countRef.current;
    // Letters live inside the pill's vertical padding; map onto that inner track.
    const track = pillHeightRef.current - RAIL_PADDING_Y * 2;
    if (count === 0 || track <= 0) return;
    const localY = pageY - pillTopRef.current - RAIL_PADDING_Y;
    const raw = Math.floor((localY / track) * count);
    const index = raw < 0 ? 0 : raw >= count ? count - 1 : raw;
    if (index === activeRef.current) return; // still on the same letter
    activeRef.current = index;
    setActive(index);
    selectionTick();
    onJumpRef.current(index);
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // Hold the gesture so a vertical drag scrubs the rail instead of
        // bubbling to the list scrolling underneath.
        onPanResponderTerminationRequest: () => false,
        // Re-measure on touch-down (the rail is fixed, but a re-measure costs
        // nothing and guards against any prior layout shift), then map by pageY.
        onPanResponderGrant: (e) => {
          measurePill();
          updateFromY.current(e.nativeEvent.pageY);
        },
        onPanResponderMove: (e) => updateFromY.current(e.nativeEvent.pageY),
        onPanResponderRelease: () => {
          activeRef.current = -1;
          setActive(null);
        },
        onPanResponderTerminate: () => {
          activeRef.current = -1;
          setActive(null);
        },
      }),
    [],
  );

  if (titles.length === 0) return null;

  // Bubble vertical center tracks the active letter within the centered pill.
  const slot = pill.height > 0 ? (pill.height - RAIL_PADDING_Y * 2) / titles.length : 0;
  const bubbleTop =
    (wrapperHeight - pill.height) / 2 + RAIL_PADDING_Y + ((active ?? 0) + 0.5) * slot - BUBBLE_SIZE / 2;

  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setWrapperHeight(e.nativeEvent.layout.height)}
      style={{ position: 'absolute', end: 4, top: 0, bottom: 0, justifyContent: 'center', pointerEvents: 'box-none' }}
    >
      {active != null ? (
        <View
          style={{
            position: 'absolute',
            end: pill.width + BUBBLE_GAP,
            top: bubbleTop,
            width: BUBBLE_SIZE,
            height: BUBBLE_SIZE,
            borderRadius: radius.full,
            backgroundColor: c.accent,
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <AppText
            variant="display"
            weight="bold"
            style={{ color: c.accentForeground, userSelect: 'none' }}
          >
            {titles[active]}
          </AppText>
        </View>
      ) : null}

      <View
        ref={pillRef}
        onLayout={measurePill}
        {...responder.panHandlers}
        style={{
          paddingVertical: RAIL_PADDING_Y,
          paddingHorizontal: 4,
          borderRadius: radius.md,
          overflow: 'hidden',
          alignItems: 'center',
        }}
      >
        <FrostedBackdrop surface="surfaceElevated" />
        {titles.map((title, i) => (
          <View key={title} style={{ paddingHorizontal: 4, paddingVertical: 1 }}>
            <AppText
              variant="micro"
              weight="semibold"
              style={{ color: i === active ? c.accent : c.textMuted, userSelect: 'none' }}
            >
              {title}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}
