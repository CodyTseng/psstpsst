import {
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';

import { radius, uiDensity, useThemeColors } from '@/theme';
import { InteractionOverlay } from './InteractionOverlay';

type Variant = 'plain' | 'surface' | 'secondary' | 'accent' | 'danger' | 'dangerSoft' | 'warningSoft' | 'overlay';
type Shape = 'circle' | 'square';

type Props = {
  /** An icon element. The caller sets its size and color (DESIGN §7) —
   * IconButton only owns the container. */
  icon: React.ReactNode;
  onPress?: (e: GestureResponderEvent) => void;
  /** Long-press handler (e.g. composer send → insert a line break when
   * Enter-to-send is on). When set, a press that's held fires this instead. */
  onLongPress?: (e: GestureResponderEvent) => void;
  /** Container size (width = height). Defaults to the platform density token. */
  size?: number;
  variant?: Variant;
  /** `circle` (default) for free-floating buttons; `square` (rounded) when
   * paired beside an input/field so the corners match. */
  shape?: Shape;
  disabled?: boolean;
  /** Specialist opt-out for clickable authored content that must not gain chrome on hover. */
  hoverFeedback?: boolean;
  hitSlop?: PressableProps['hitSlop'];
  /** For positioning (absolute floats) — not for restyling the circle. */
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

/**
 * The single round icon-button primitive (DESIGN §8). Every circular,
 * icon-only tap target goes through this — never a hand-rolled Pressable.
 *
 * - `plain`     transparent, press → interactionOverlay. Title-bar and light actions.
 * - `surface`   sits on a surface chip. Composer attach and the like.
 * - `secondary` the one and only secondary icon action (profile action rows):
 *               the elevated list-row surface plus a hairline border. Matches
 *               AppButton `secondary`, so icon and text buttons read as one set.
 * - `accent`    filled accent (primary icon action, e.g. send). Disabled →
 *               surfaceMuted; pass a dimmed icon color for the disabled glyph.
 * - `danger`    filled danger (destructive icon action); pair with a background-
 *               coloured glyph so the action reads as one solid control.
 * - `dangerSoft` quiet destructive action: a soft danger fill with a danger glyph.
 * - `warningSoft` recoverable status action: a soft warning fill without a border.
 * - `overlay`   mostly opaque neutral fill over media, lightened on hover/press
 *               for visible feedback and legible white glyphs on any image.
 *
 * On Electron every variant shows pointer hover feedback through the same
 * overlay used for press.
 */
export function IconButton({
  icon,
  onPress,
  onLongPress,
  size = uiDensity.iconButtonSize,
  variant = 'plain',
  shape = 'circle',
  disabled,
  hoverFeedback = true,
  hitSlop,
  style,
  accessibilityLabel,
}: Props) {
  const c = useThemeColors();

  function bg(pressed: boolean): string {
    switch (variant) {
      case 'surface':
        return c.surface;
      case 'secondary':
        return c.surfaceElevated;
      case 'accent':
        if (disabled) return c.surfaceMuted;
        return c.accent;
      case 'danger':
        return c.danger;
      case 'dangerSoft':
        return c.dangerSoft;
      case 'warningSoft':
        return c.warningSoft;
      case 'overlay':
        return pressed ? c.overlayControlActive : c.overlayControl;
      case 'plain':
      default:
        return 'transparent';
    }
  }

  // `secondary` matches AppButton secondary: its elevated surface always
  // carries a 1px border hairline.
  const bordered = variant === 'secondary';

  // The accent variant signals its disabled state through bg + icon color, so
  // it shouldn't also dim; other variants dim via opacity.
  const dim = disabled && variant !== 'accent' && variant !== 'danger';

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      hoverFeedback={hoverFeedback}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: shape === 'square' ? radius.lg : size / 2,
          borderWidth: bordered ? 1 : 0,
          borderColor: bordered ? c.border : undefined,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: bg(!disabled && pressed),
          opacity: dim ? 0.5 : 1,
        },
        style,
      ]}
    >
      {({ pressed }) => (
        <>
          {!disabled && pressed && variant !== 'overlay' ? (
            <InteractionOverlay borderRadius={shape === 'square' ? radius.lg : size / 2} />
          ) : null}
          {icon}
        </>
      )}
    </Pressable>
  );
}
