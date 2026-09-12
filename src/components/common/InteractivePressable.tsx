import { forwardRef, type ReactNode, useState } from 'react';
import {
  Pressable,
  type PressableProps,
  type PressableStateCallbackType,
  Platform,
  StyleSheet,
  type View,
} from 'react-native';

type PointerPressableState = PressableStateCallbackType & {
  /** React Native Web supplies this at runtime, but React Native's shared type omits it. */
  readonly hovered?: boolean;
};

type PressFeedbackMode = 'immediate' | 'delayed' | 'none';

type Props = PressableProps & {
  /** Infrastructure-only escape hatch for invisible dismissal and gesture layers. */
  hoverFeedback?: boolean;
  /** Disable the opacity fallback when children paint a dedicated hover visual. */
  fallbackHoverOpacity?: boolean;
  /** Immediate for controls, delayed for scrollable rows, none for authored content. */
  pressFeedback?: PressFeedbackMode;
};

type HoverEvent = Parameters<NonNullable<PressableProps['onHoverIn']>>[0];

const FALLBACK_HOVER_OPACITY = 0.85;
export const LIST_PRESS_DELAY_MS = 80;

export function resolvePressDelay(
  pressFeedback: PressFeedbackMode,
  explicitDelay: number | undefined,
): number | undefined {
  return explicitDelay ?? (pressFeedback === 'delayed' ? LIST_PRESS_DELAY_MS : undefined);
}

export function resolveInteractiveState(
  state: PointerPressableState,
  hovered: boolean,
  pressFeedback = true,
): PressableStateCallbackType {
  const activeHover = hovered || state.hovered === true;
  if (activeHover) {
    return { ...state, hovered: true, pressed: true } as PointerPressableState;
  }
  return !pressFeedback && state.pressed ? { ...state, pressed: false } : state;
}

export function isInteractiveHovered(state: PressableStateCallbackType): boolean {
  return (state as PointerPressableState).hovered === true;
}

export function supportsHoverPointer(pointerType: string | undefined): boolean {
  return pointerType === 'mouse' || pointerType === 'pen';
}

/**
 * Internal Pressable foundation for specialist interactive surfaces.
 *
 * When a mouse, trackpad, or hovering stylus activates hover, it feeds that
 * state through the existing pressed render path so every surface reuses its
 * established feedback. A surface with only static styles receives the design
 * system's standard opacity feedback instead.
 * Text and icon buttons still belong to AppButton and IconButton.
 */
export const InteractivePressable = forwardRef<View, Props>(function InteractivePressable(
  {
    children,
    accessible,
    disabled,
    fallbackHoverOpacity = true,
    hoverFeedback,
    onHoverIn,
    onHoverOut,
    onPointerEnter,
    onPointerLeave,
    pressFeedback = 'immediate',
    style,
    tabIndex,
    unstable_pressDelay,
    ...props
  },
  ref,
) {
  const feedbackEnabled = hoverFeedback ?? (accessible !== false && tabIndex !== -1);
  const [hovered, setHovered] = useState(false);
  const activeHover = feedbackEnabled && !disabled && hovered;
  const resolveState = (state: PressableStateCallbackType) =>
    disabled
      ? { ...state, pressed: false, hovered: false }
      : feedbackEnabled
      ? resolveInteractiveState(
          state as PointerPressableState,
          activeHover,
          pressFeedback !== 'none',
        )
      : pressFeedback !== 'none' || !state.pressed
        ? state
        : { ...state, pressed: false };
  const pressDelay = resolvePressDelay(pressFeedback, unstable_pressDelay);
  const platformDelayProps =
    Platform.OS === 'web'
      ? ({ delayPressIn: pressDelay } as unknown as PressableProps)
      : { unstable_pressDelay: pressDelay };

  const resolvedChildren: ReactNode | ((state: PressableStateCallbackType) => ReactNode) =
    typeof children === 'function' ? (state) => children(resolveState(state)) : children;

  return (
    <Pressable
      {...props}
      {...platformDelayProps}
      ref={ref}
      accessible={accessible}
      disabled={disabled}
      tabIndex={tabIndex}
      onPointerEnter={(event) => {
        onPointerEnter?.(event);
        if (!disabled && supportsHoverPointer(event.nativeEvent.pointerType)) {
          if (feedbackEnabled) setHovered(true);
          onHoverIn?.(event as unknown as HoverEvent);
        }
      }}
      onPointerLeave={(event) => {
        onPointerLeave?.(event);
        if (supportsHoverPointer(event.nativeEvent.pointerType)) {
          if (feedbackEnabled) setHovered(false);
          onHoverOut?.(event as unknown as HoverEvent);
        }
      }}
      style={(state) => {
        const interactiveState = resolveState(state);
        if (typeof style === 'function') {
          return [feedbackEnabled && !disabled && styles.pointer, style(interactiveState)];
        }
        return [
          feedbackEnabled && !disabled && styles.pointer,
          style,
          feedbackEnabled &&
            fallbackHoverOpacity &&
            !disabled &&
            (activeHover || (state as PointerPressableState).hovered) &&
            styles.hovered,
        ];
      }}
    >
      {resolvedChildren}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  pointer: {
    cursor: 'pointer',
  },
  hovered: {
    opacity: FALLBACK_HOVER_OPACITY,
  },
});
