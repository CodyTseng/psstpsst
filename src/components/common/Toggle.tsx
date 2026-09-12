import { useEffect } from 'react';
import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';
import Animated, {
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useIsRTL } from '@/i18n/direction';
import { radius, uiDensity, useThemeColors } from '@/theme';

type Props = {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
};

// iOS-proportioned switch, drawn from plain Views so it sits in the exact center
// of its own box. The platform `<Switch>` can't: on Android it's a SwitchCompat
// (a TextView under the hood) whose reported height is driven by font metrics,
// so flex-centering centers a text box, not the visible track — leaving it
// optically off by a font/density-dependent amount that no constant offset fixes.
const PAD = 2;
const TRACK_W = uiDensity.toggleTrackWidth;
const TRACK_H = uiDensity.toggleTrackHeight;
const THUMB = TRACK_H - PAD * 2;
const TRAVEL = TRACK_W - THUMB - PAD * 2;

/**
 * The single on/off control (DESIGN §8): a self-drawn switch so the track
 * stays vertically centered in any row and every color comes from a theme token
 * (track `accent` when on / `surfaceMuted` when off, thumb `accentForeground`).
 * Use it as a {@link ListRow} `trailing` accessory for a boolean setting row
 * (the row is non-tappable — the switch is the target). Don't hand-roll a switch
 * elsewhere; route every toggle through this so they read identically.
 */
export function Toggle({ value, onValueChange, disabled }: Props) {
  const c = useThemeColors();
  const isRTL = useIsRTL();
  const progress = useSharedValue(value ? 1 : 0);

  // Drive the animation from the controlled prop — JS stays the source of truth.
  useEffect(() => {
    progress.value = withTiming(value ? 1 : 0, { duration: 180 });
  }, [value, progress]);

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], [c.surfaceMuted, c.accent]),
  }));
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(progress.value, [0, 1], [0, isRTL ? -TRAVEL : TRAVEL]) },
    ],
  }));

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      style={{ opacity: disabled ? 0.5 : 1 }}
    >
      <Animated.View
        style={[
          {
            width: TRACK_W,
            height: TRACK_H,
            borderRadius: radius.full,
            padding: PAD,
            direction: isRTL ? 'rtl' : 'ltr',
          },
          trackStyle,
        ]}
      >
        <Animated.View
          style={[
            {
              width: THUMB,
              height: THUMB,
              borderRadius: radius.full,
              backgroundColor: c.accentForeground,
            },
            thumbStyle,
          ]}
        />
      </Animated.View>
    </Pressable>
  );
}
