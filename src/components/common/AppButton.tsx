import {
  ActivityIndicator,
  type PressableProps,
  StyleSheet,
  type TextProps,
  View,
} from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';

import { AppText } from './AppText';
import { InteractionOverlay } from './InteractionOverlay';
import { radius, uiDensity, useThemeColors } from '@/theme';

type Variant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'accentGhost'
  | 'text'
  | 'accentText'
  | 'danger';
type Size = 'sm' | 'md' | 'lg' | 'xl';

type Props = Omit<PressableProps, 'children' | 'style'> & {
  /** Button text. Optional so the button can be icon-only (e.g. a back control
   * that carries a chevron + an occasional count); pass `accessibilityLabel`
   * for that case. */
  label?: string;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  labelVariant?: 'body' | 'caption' | 'subtitle' | 'title' | 'display' | 'amount' | 'code';
  labelNumberOfLines?: TextProps['numberOfLines'];
  labelEllipsizeMode?: TextProps['ellipsizeMode'];
  orientation?: 'horizontal' | 'vertical';
  contentAlign?: 'center' | 'baseline';
  contentJustify?: 'center' | 'start';
  fullWidth?: boolean;
  /** Corner radius: `lg` (default, the standard button) or `full` (a pill that
   * hugs its content — pair with `fullWidth={false}`). */
  corner?: 'lg' | 'full';
  /** Icon-button parity: instead of the text-button height + wide horizontal
   * padding, hug the content with an **equal inset on all four sides** (like
   * `IconButton`). For chevron/icon (+ badge) pills — pair with
   * `fullWidth={false}` + `corner="full"`. Pure text variants always keep
   * their intrinsic text height; `compactAxis="none"` removes their visible
   * horizontal inset while hit slop preserves the touch target. */
  compact?: boolean;
  compactAxis?: 'all' | 'horizontal' | 'none';
};

// Equal inset for compact pills, matching the registered icon-button language.
const COMPACT_INSET = 8;

export function AppButton({
  label,
  variant = 'primary',
  size: sizeProp,
  loading,
  iconLeft,
  iconRight,
  labelVariant = 'body',
  labelNumberOfLines,
  labelEllipsizeMode,
  orientation = 'horizontal',
  contentAlign = 'center',
  contentJustify = 'center',
  fullWidth: fullWidthProp,
  corner: cornerProp,
  compact: compactProp,
  compactAxis: compactAxisProp,
  disabled,
  hitSlop,
  ...rest
}: Props) {
  const c = useThemeColors();
  const textChrome = variant === 'text' || variant === 'accentText';
  const size = sizeProp ?? 'md';
  const fullWidth = fullWidthProp ?? !textChrome;
  const corner = cornerProp ?? (textChrome ? 'full' : 'lg');
  const compact = compactProp ?? false;
  const compactAxis = compactAxisProp ?? 'all';

  // For framed controls, size controls height/padding. Label hierarchy is
  // explicit through `labelVariant` and its documented uses in DESIGN §8.
  const sizing = uiDensity.button[size];
  const textPressedOpacity = labelVariant === 'amount' ? 0.85 : 0.55;

  const variants: Record<
    Variant,
    { bg: string; text: string; border?: string; pressedOpacity?: number }
  > = {
    primary: {
      bg: c.accent,
      text: c.accentForeground,
    },
    // Secondary actions share the elevated list-row surface in both themes and
    // retain a hairline border so their tappable boundary stays explicit.
    secondary: {
      bg: c.surfaceElevated,
      text: c.text,
      border: c.border,
    },
    ghost: {
      bg: 'transparent',
      text: c.textMuted,
    },
    accentGhost: {
      bg: 'transparent',
      text: c.accent,
    },
    // Pure text chrome (title-bar right slot, sheet shell top action): no fill
    // at rest and no capsule — press feedback is opacity only.
    text: {
      bg: 'transparent',
      text: c.text,
      pressedOpacity: textPressedOpacity,
    },
    accentText: {
      bg: 'transparent',
      text: c.accent,
      pressedOpacity: textPressedOpacity,
    },
    danger: {
      bg: c.dangerSoft,
      text: c.danger,
    },
  };
  const v = variants[variant];
  const largeNumericLabel = labelVariant === 'display' || labelVariant === 'amount';
  const singleLineNumericLabel = labelVariant === 'amount';
  const technicalLabel = labelVariant === 'code';
  const quietChrome = variant === 'ghost' || variant === 'text' || variant === 'accentText';
  const textColor = largeNumericLabel ? c.text : v.text;
  const isDisabled = disabled || loading;
  const buttonRadius = corner === 'full' ? radius.full : radius.lg;
  // Text chrome stays visually equal to its text line. Expand only the hit
  // target, so accessibility does not force a larger layout box.
  const resolvedHitSlop = hitSlop ?? (textChrome ? COMPACT_INSET : undefined);

  return (
    <Pressable
      {...rest}
      hitSlop={resolvedHitSlop}
      disabled={isDisabled}
      style={({ pressed }) => ({
        // Pure text chrome stays intrinsic-height. Framed controls use compact
        // insets or their registered control height + side padding.
        ...(textChrome
          ? {
              paddingHorizontal: compact && compactAxis === 'none' ? 0 : COMPACT_INSET,
              paddingVertical: 0,
            }
          : compact
            ? compactAxis === 'horizontal'
              ? { paddingHorizontal: COMPACT_INSET, paddingVertical: 0 }
              : compactAxis === 'none'
                ? { padding: 0 }
                : { padding: COMPACT_INSET }
            : {
                // A label must remain readable in every locale. Standard buttons
                // retain their registered height for one line and grow only when
                // a full-width label genuinely needs another line.
                minHeight: sizing.height,
                paddingHorizontal: sizing.horizontalPadding,
              }),
        backgroundColor: v.bg,
        borderColor: v.border ?? 'transparent',
        borderWidth: v.border ? 1 : 0,
        borderRadius: buttonRadius,
        alignItems: contentJustify === 'start' ? 'stretch' : 'center',
        justifyContent: contentJustify === 'start' ? 'flex-start' : 'center',
        flexDirection: orientation === 'vertical' ? 'column' : 'row',
        maxWidth: '100%',
        opacity: isDisabled ? 0.5 : pressed ? (v.pressedOpacity ?? 1) : 1,
        alignSelf: fullWidth ? 'stretch' : 'flex-start',
      })}
    >
      {({ pressed }) => (
        <>
          {!isDisabled && pressed && !textChrome ? (
            <InteractionOverlay borderRadius={buttonRadius} />
          ) : null}
          <View
            style={{
              flexDirection: orientation === 'vertical' ? 'column' : 'row',
              alignItems:
                contentAlign === 'baseline' && orientation === 'horizontal'
                  ? 'baseline'
                  : 'center',
              justifyContent: contentJustify === 'start' ? 'flex-start' : 'center',
              gap: orientation === 'vertical' ? 4 : 8,
              maxWidth: '100%',
              width: contentJustify === 'start' ? '100%' : undefined,
              alignSelf: contentJustify === 'start' ? 'stretch' : undefined,
              opacity: loading ? 0 : 1,
            }}
          >
            {iconLeft ? <View style={{ flexShrink: 0 }}>{iconLeft}</View> : null}
            {label != null ? (
              <AppText
                variant={labelVariant}
                weight={
                  largeNumericLabel
                    ? 'bold'
                    : technicalLabel
                      ? 'regular'
                      : quietChrome
                        ? // Quiet chrome softens only the default body label to
                          // medium; an explicit labelVariant keeps its natural
                          // weight (e.g. a subtitle interactive title stays
                          // semibold).
                          labelVariant === 'body'
                          ? 'medium'
                          : undefined
                        : 'semibold'
                }
                numberOfLines={labelNumberOfLines ?? (singleLineNumericLabel ? 1 : undefined)}
                ellipsizeMode={labelEllipsizeMode}
                adjustsFontSizeToFit={singleLineNumericLabel}
                minimumFontScale={singleLineNumericLabel ? 0.68 : undefined}
                style={{
                  color: textColor,
                  flexShrink: 1,
                  userSelect: 'none',
                  // Android otherwise adds platform font padding outside the
                  // declared line height, making an intrinsic text action taller.
                  includeFontPadding: textChrome ? false : undefined,
                }}
              >
                {label}
              </AppText>
            ) : null}
            {iconRight ? <View style={{ flexShrink: 0 }}>{iconRight}</View> : null}
          </View>
          {loading ? (
            <View
              style={[StyleSheet.absoluteFill, styles.loadingIndicator, { pointerEvents: 'none' }]}
            >
              <ActivityIndicator size="small" color={textColor} />
            </View>
          ) : null}
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  loadingIndicator: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
