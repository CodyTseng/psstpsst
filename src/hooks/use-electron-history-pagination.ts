import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

import { isNearMessageHistoryEdge } from '@/lib/chat/message-tail-follow';
import { IS_ELECTRON } from '@/lib/platform';

const SCROLL_NODE_BIND_RETRY_FRAMES = 60;

/** RN Web has no native drag/momentum callbacks. Check the inverted history
 * edge after actual input, never from layout or programmatic scroll events. */
export function useElectronHistoryPagination({
  listRef,
  mounted,
  onHistoryEdge,
}: {
  listRef: RefObject<{ getScrollableNode(): unknown } | null>;
  mounted: boolean;
  onHistoryEdge: () => void;
}) {
  const callbackRef = useRef(onHistoryEdge);
  useLayoutEffect(() => {
    callbackRef.current = onHistoryEdge;
  }, [onHistoryEdge]);

  useEffect(() => {
    if (!IS_ELECTRON || !mounted) return;
    let bindFrame: number | null = null;
    let frame: number | null = null;
    let scrollbarDrag = false;
    let removeListeners: (() => void) | null = null;

    const bind = (attempt: number) => {
      const node = listRef.current?.getScrollableNode() as HTMLElement | undefined;
      if (!node?.addEventListener) {
        if (attempt < SCROLL_NODE_BIND_RETRY_FRAMES) {
          bindFrame = requestAnimationFrame(() => bind(attempt + 1));
        }
        return;
      }

      const owner = node.ownerDocument;
      const checkAfterInput = () => {
        if (frame !== null) return;
        frame = requestAnimationFrame(() => {
          frame = null;
          if (isNearMessageHistoryEdge({
            offsetY: node.scrollTop,
            contentHeight: node.scrollHeight,
            viewportHeight: node.clientHeight,
          })) callbackRef.current();
        });
      };
      const wheel = (event: WheelEvent) => {
        if (!event.ctrlKey && event.deltaY !== 0) checkAfterInput();
      };
      const pointerDown = (event: PointerEvent) => {
        // Native scrollbar input targets the scroll element itself. Bubble clicks
        // target descendants and must not authorize paging.
        scrollbarDrag = event.button === 0 && event.target === node;
        if (scrollbarDrag) checkAfterInput();
      };
      const pointerMove = (event: PointerEvent) => {
        if (scrollbarDrag && (event.buttons & 1) !== 0) checkAfterInput();
      };
      const pointerUp = () => {
        if (scrollbarDrag) checkAfterInput();
        scrollbarDrag = false;
      };
      node.addEventListener('wheel', wheel, { passive: true });
      node.addEventListener('pointerdown', pointerDown);
      owner.addEventListener('pointermove', pointerMove);
      owner.addEventListener('pointerup', pointerUp);
      owner.addEventListener('pointercancel', pointerUp);
      removeListeners = () => {
        node.removeEventListener('wheel', wheel);
        node.removeEventListener('pointerdown', pointerDown);
        owner.removeEventListener('pointermove', pointerMove);
        owner.removeEventListener('pointerup', pointerUp);
        owner.removeEventListener('pointercancel', pointerUp);
      };
    };

    bind(0);
    return () => {
      if (bindFrame !== null) cancelAnimationFrame(bindFrame);
      if (frame !== null) cancelAnimationFrame(frame);
      removeListeners?.();
    };
  }, [listRef, mounted]);
}
