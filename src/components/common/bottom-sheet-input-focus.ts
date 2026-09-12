import type { RefObject } from 'react';

type FocusableInput = {
  focus: () => void;
};

/**
 * Defers focus until the frame after a native Modal reports that it is shown.
 * React Native Android clears the dialog's non-focusable window flag only
 * after dispatching that event, so focusing inside the callback can lose the
 * software-keyboard request.
 */
export function scheduleBottomSheetInputFocus(
  inputRef: RefObject<FocusableInput | null>,
): () => void {
  let pending = true;
  const frame = requestAnimationFrame(() => {
    pending = false;
    inputRef.current?.focus();
  });
  return () => {
    if (pending) cancelAnimationFrame(frame);
  };
}
