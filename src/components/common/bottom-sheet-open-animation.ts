/**
 * Starts the entrance transition one frame after the native Modal reports that
 * it is shown. This gives the modal window and its first layout a committed
 * off-screen frame before the UI-thread animation begins.
 */
export function scheduleBottomSheetOpenAnimation(start: () => void): () => void {
  let pending = true;
  const frame = requestAnimationFrame(() => {
    pending = false;
    start();
  });
  return () => {
    if (pending) cancelAnimationFrame(frame);
  };
}
