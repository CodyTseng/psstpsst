import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

import { isNearMessageHistoryEdge } from '@/lib/chat/message-tail-follow';
import { IS_ELECTRON } from '@/lib/platform';

const SCROLL_NODE_BIND_RETRY_FRAMES = 60;
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

/** RN Web has no native drag/momentum callbacks. Check the inverted history
 * edge after actual input, never from layout or programmatic scroll events. */
export function useElectronHistoryPagination({
  listRef,
  mounted,
  windowKey,
  onHistoryEdge,
  onUserInput,
}: {
  listRef: RefObject<{ getScrollableNode(): unknown } | null>;
  mounted: boolean;
  /** Rebind when a keyed list replaces its scroll node without unmounting the hook. */
  windowKey: string;
  onHistoryEdge: () => void;
  onUserInput?: () => void;
}) {
  const callbacksRef = useRef({ onHistoryEdge, onUserInput });
  useLayoutEffect(() => {
    callbacksRef.current = { onHistoryEdge, onUserInput };
  }, [onHistoryEdge, onUserInput]);

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
          })) callbacksRef.current.onHistoryEdge();
        });
      };
      const reportInput = () => {
        callbacksRef.current.onUserInput?.();
        checkAfterInput();
      };
      const wheel = (event: WheelEvent) => {
        if (!event.ctrlKey && event.deltaY !== 0) reportInput();
      };
      const keyDown = (event: KeyboardEvent) => {
        if (
          event.defaultPrevented || event.isComposing ||
          event.ctrlKey || event.metaKey || event.altKey ||
          (event.shiftKey && event.key !== ' ') || !SCROLL_KEYS.has(event.key)
        ) return;
        // Only keys bubbling from the list can scroll it. Editable and action
        // descendants own their keys; composer events never reach this node.
        const target = event.target as Element | null;
        if (target?.closest('input, textarea, select, button, a[href], [role="button"], [role="textbox"], [contenteditable]:not([contenteditable="false"])')) return;
        reportInput();
      };
      const pointerDown = (event: PointerEvent) => {
        // Native scrollbar input targets the scroll element itself. Bubble clicks
        // target descendants and must not authorize paging.
        scrollbarDrag = event.button === 0 && event.target === node;
        if (scrollbarDrag) {
          reportInput();
        }
      };
      const pointerMove = (event: PointerEvent) => {
        if (scrollbarDrag && (event.buttons & 1) !== 0) checkAfterInput();
      };
      const pointerUp = () => {
        if (scrollbarDrag) checkAfterInput();
        scrollbarDrag = false;
      };
      node.addEventListener('wheel', wheel, { passive: true });
      node.addEventListener('keydown', keyDown);
      node.addEventListener('pointerdown', pointerDown);
      owner.addEventListener('pointermove', pointerMove);
      owner.addEventListener('pointerup', pointerUp);
      owner.addEventListener('pointercancel', pointerUp);
      removeListeners = () => {
        node.removeEventListener('wheel', wheel);
        node.removeEventListener('keydown', keyDown);
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
  }, [listRef, mounted, windowKey]);
}
