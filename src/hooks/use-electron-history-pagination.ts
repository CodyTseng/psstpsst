import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

import { isNearMessageHistoryEdge } from '@/lib/chat/message-tail-follow';
import { IS_ELECTRON } from '@/lib/platform';

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
    const node = listRef.current?.getScrollableNode() as HTMLElement | undefined;
    if (!node?.addEventListener) return;
    const owner = node.ownerDocument;
    let frame: number | null = null;
    let scrollbarDrag = false;
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
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      node.removeEventListener('wheel', wheel);
      node.removeEventListener('pointerdown', pointerDown);
      owner.removeEventListener('pointermove', pointerMove);
      owner.removeEventListener('pointerup', pointerUp);
      owner.removeEventListener('pointercancel', pointerUp);
    };
  }, [listRef, mounted]);
}
