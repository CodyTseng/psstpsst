import { useLayoutEffect } from 'react';

import type { MediaPageFrameProps } from './MediaPageFrame';

/** Retain Chromium's direct scrolling and snap animation while stopping a fling
 * at the next page. Absolute positioning (keyboard, resize, prepend) still
 * reaches its requested page; no wheel-event lock can swallow a later swipe. */
export function MediaPageFrame({ width, height, children, onReady }: MediaPageFrameProps) {
  useLayoutEffect(() => { onReady?.(); }, [onReady, width, height]);
  return (
    <div style={{ position: 'relative', width, height, scrollSnapAlign: 'start', scrollSnapStop: 'always' }}>
      {children}
    </div>
  );
}
