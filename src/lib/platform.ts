import { Platform, type KeyboardAvoidingViewProps } from 'react-native';

/** Platform identity is process-stable; expose constants instead of rechecking it. */
export const IS_ANDROID = Platform.OS === 'android';
export const IS_IOS = Platform.OS === 'ios';
export const IS_ELECTRON =
  Platform.OS === 'web' &&
  typeof window !== 'undefined' &&
  typeof window.psstpsstDesktop !== 'undefined';
export const DESKTOP_OS = IS_ELECTRON
  ? window.psstpsstDesktop?.system.platform
  : undefined;

/** Shared pushed-screen keyboard avoidance policy. */
export const KEYBOARD_AVOIDING_BEHAVIOR: KeyboardAvoidingViewProps['behavior'] | undefined =
  IS_IOS ? 'padding' : undefined;

/** React Native Web forwards this browser event, but native RN does not expose
 * it in the shared View/Pressable prop types. */
export type DesktopContextMenuEvent = {
  preventDefault?: () => void;
  stopPropagation?: () => void;
  clientX?: number;
  clientY?: number;
  pageX?: number;
  pageY?: number;
  nativeEvent?: {
    pageX?: number;
    pageY?: number;
    clientX?: number;
    clientY?: number;
  };
};

export type DesktopPointerPoint = { x: number; y: number };

/** Read viewport coordinates from React Native Web's context-menu event. */
export function desktopContextMenuPoint(
  event: DesktopContextMenuEvent,
): DesktopPointerPoint | undefined {
  const x =
    event.nativeEvent?.clientX ?? event.clientX ?? event.nativeEvent?.pageX ?? event.pageX;
  const y =
    event.nativeEvent?.clientY ?? event.clientY ?? event.nativeEvent?.pageY ?? event.pageY;
  return typeof x === 'number' &&
    Number.isFinite(x) &&
    typeof y === 'number' &&
    Number.isFinite(y)
    ? { x, y }
    : undefined;
}
