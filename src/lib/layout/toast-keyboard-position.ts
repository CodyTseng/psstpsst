/** Lift a bottom-safe-area overlay above the keyboard without counting the
 * safe-area inset twice. Keyboard-controller reports height as a negative
 * translation and progress from 0 to 1. */
export function toastKeyboardTranslateY(
  keyboardHeight: number,
  keyboardProgress: number,
  safeAreaBottom: number,
): number {
  'worklet';
  return keyboardHeight + keyboardProgress * safeAreaBottom;
}
