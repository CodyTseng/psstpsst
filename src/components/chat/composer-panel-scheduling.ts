/**
 * Runs non-urgent panel setup in the macrotask after the next animation frame.
 * The UI-thread panel transition gets a chance to paint before React mounts a
 * comparatively expensive body such as the custom-emoji grid.
 */
export function scheduleComposerPanelWorkAfterPaint(work: () => void): () => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let pending = true;
  const frame = requestAnimationFrame(() => {
    timeout = setTimeout(() => {
      pending = false;
      work();
    }, 0);
  });

  return () => {
    if (!pending) return;
    cancelAnimationFrame(frame);
    if (timeout !== null) clearTimeout(timeout);
  };
}

/** Directly interpolates the occupied slot from an open panel to the keyboard. */
export function interpolateComposerPanelToKeyboard(
  panelHeight: number,
  keyboardHeight: number,
  progress: number,
  safeHeight: number,
): number {
  'worklet';
  const clampedProgress = Math.min(1, Math.max(0, progress));
  return Math.max(
    safeHeight,
    panelHeight * (1 - clampedProgress) + keyboardHeight,
  );
}
