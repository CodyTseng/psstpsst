import { useEffect, useRef, useState, type PointerEvent } from 'react';

import type { ImagePointerPanProps } from './ImagePointerPan';

const SINGLE_CLICK_DELAY_MS = 500;
const CLICK_SLOP = 8;
const WHEEL_ZOOM_SENSITIVITY = 0.01;
const MAX_WHEEL_ZOOM_DELTA = 100;

/** Own desktop clicks, pointer drags, and trackpad gestures before touch recognizers. */
export function ImagePointerPan({
  enabled,
  onStart,
  onMove,
  onWheelPan,
  onWheelZoom,
  onSingleClick,
  onDoubleClick,
  children,
}: ImagePointerPanProps) {
  const surface = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const press = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const moved = useRef(false);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelHandlers = useRef({ enabled, onWheelPan, onWheelZoom });
  const [dragging, setDragging] = useState(false);

  function clearClickTimer() {
    if (clickTimer.current !== null) clearTimeout(clickTimer.current);
    clickTimer.current = null;
  }

  useEffect(() => clearClickTimer, [enabled]);
  useEffect(() => {
    wheelHandlers.current = { enabled, onWheelPan, onWheelZoom };
  }, [enabled, onWheelPan, onWheelZoom]);

  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const target = element;

    function handleWheel(event: WheelEvent) {
      const handlers = wheelHandlers.current;
      const rect = target.getBoundingClientRect();
      const deltaUnit = event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? Math.max(rect.height, 1)
          : 1;
      const deltaX = event.deltaX * deltaUnit;
      const deltaY = event.deltaY * deltaUnit;

      // Chromium reports a trackpad pinch as a ctrl-modified wheel event.
      if (event.ctrlKey) {
        event.preventDefault();
        event.stopPropagation();
        const boundedDelta = Math.max(-MAX_WHEEL_ZOOM_DELTA, Math.min(MAX_WHEEL_ZOOM_DELTA, deltaY));
        handlers.onWheelZoom(
          Math.exp(-boundedDelta * WHEEL_ZOOM_SENSITIVITY),
          event.clientX - rect.left - rect.width / 2,
          event.clientY - rect.top - rect.height / 2,
        );
        return;
      }

      if (!handlers.enabled || (deltaX === 0 && deltaY === 0)) return;
      event.preventDefault();
      event.stopPropagation();
      handlers.onWheelPan(-deltaX, -deltaY);
    }

    // React registers wheel events as passive. A native non-passive listener is
    // required to keep a pinch from changing Chromium's page zoom.
    target.addEventListener('wheel', handleWheel, { passive: false });
    return () => target.removeEventListener('wheel', handleWheel);
  }, []);

  function move(event: PointerEvent<HTMLDivElement>) {
    const down = press.current;
    if (down?.pointerId === event.pointerId &&
      Math.hypot(event.clientX - down.x, event.clientY - down.y) > CLICK_SLOP) {
      moved.current = true;
      clearClickTimer();
    }
    const start = drag.current;
    if (!start || start.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (enabled) onMove(event.clientX - start.x, event.clientY - start.y);
  }

  function stop(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div
      ref={surface}
      style={{
        position: 'absolute', inset: 0,
        cursor: enabled ? (dragging ? 'grabbing' : 'grab') : 'auto',
        touchAction: 'none', userSelect: 'none',
      }}
      onPointerDownCapture={(event) => {
        if (event.button === 0) {
          clearClickTimer();
          press.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
          moved.current = false;
        }
        if (!enabled || event.pointerType !== 'mouse' || event.button !== 0 || drag.current) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
        onStart();
        setDragging(true);
      }}
      onPointerMoveCapture={move}
      onPointerUpCapture={(event) => {
        move(event);
        if (press.current?.pointerId === event.pointerId) press.current = null;
        stop(event);
      }}
      onPointerCancelCapture={(event) => {
        moved.current = true;
        press.current = null;
        clearClickTimer();
        stop(event);
      }}
      onLostPointerCapture={stop}
      onDragStart={(event) => event.preventDefault()}
      onClick={(event) => {
        event.stopPropagation();
        clearClickTimer();
        if (enabled || moved.current || event.detail > 1) return;
        clickTimer.current = setTimeout(() => {
          clickTimer.current = null;
          onSingleClick();
        }, SINGLE_CLICK_DELAY_MS);
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        clearClickTimer();
        if (moved.current) return;
        onDoubleClick();
      }}
    >
      {children}
    </div>
  );
}
