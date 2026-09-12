import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsRTL } from '@/i18n/direction';
import { clampDesktopPrimaryPaneWidth } from '@/lib/layout/wide-layout';
import { useDesktopLayoutStore } from '@/stores/desktop-layout.store';
import { useThemeColors } from '@/theme';
import { wideLayout } from '@/theme/layout';
import type { PrimaryPaneProps } from './PrimaryPane';

export function PrimaryPane({ windowWidth, children }: PrimaryPaneProps) {
  const c = useThemeColors();
  const { t } = useTranslation();
  const isRTL = useIsRTL();
  const [requestedWidth, setRequestedWidth] = useState(() => useDesktopLayoutStore.getState().primaryWidth);
  const [active, setActive] = useState(false);
  const [hovered, setHovered] = useState(false);
  const drag = useRef<{ pointerId: number; x: number; width: number } | null>(null);
  const frame = useRef<number | null>(null);
  const pendingWidth = useRef(requestedWidth);
  const width = clampDesktopPrimaryPaneWidth(windowWidth, requestedWidth);
  const maximum = clampDesktopPrimaryPaneWidth(windowWidth, windowWidth);

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    useDesktopLayoutStore.getState().setPrimaryWidth(pendingWidth.current);
  }, []);

  function updateWidth(nextWidth: number, commit = false) {
    pendingWidth.current = clampDesktopPrimaryPaneWidth(windowWidth, nextWidth);
    if (commit) useDesktopLayoutStore.getState().setPrimaryWidth(pendingWidth.current);
    // Coalesce pointer events and update only this shell, preserving children.
    if (frame.current === null) {
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        setRequestedWidth(pendingWidth.current);
      });
    }
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (!start || event.pointerId !== start.pointerId) return;
    updateWidth(start.width + (event.clientX - start.x) * (isRTL ? -1 : 1));
  }

  function stop(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    useDesktopLayoutStore.getState().setPrimaryWidth(pendingWidth.current);
    setActive(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'} style={{
      display: 'flex', flexDirection: 'column', position: 'relative',
      width, flexShrink: 0, minHeight: 0, boxSizing: 'border-box',
      borderInlineEnd: `1px solid ${c.border}`,
    }}>
      {children}
      <div
        role="separator"
        aria-label={t('common.resize_sidebar')}
        aria-orientation="vertical"
        aria-valuemin={wideLayout.primaryDesktopMinWidth}
        aria-valuemax={maximum}
        aria-valuenow={width}
        tabIndex={0}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onPointerDown={(event) => {
          if (event.button !== 0 || drag.current) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { pointerId: event.pointerId, x: event.clientX, width };
          setActive(true);
        }}
        onPointerMove={move}
        onPointerUp={(event) => { move(event); stop(event); }}
        onPointerCancel={stop}
        onLostPointerCapture={stop}
        onDoubleClick={() => updateWidth(wideLayout.primaryDesktopWidth, true)}
        onKeyDown={(event) => {
          let nextWidth: number;
          if (event.key === 'Home') nextWidth = wideLayout.primaryDesktopMinWidth;
          else if (event.key === 'End') nextWidth = maximum;
          else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            nextWidth = width + wideLayout.paneResizeKeyboardStep
              * (event.key === 'ArrowRight' ? 1 : -1) * (isRTL ? -1 : 1);
          } else return;
          event.preventDefault();
          updateWidth(nextWidth, true);
        }}
        style={{
          position: 'absolute', insetBlock: 0,
          insetInlineEnd: -wideLayout.paneResizeHandleWidth / 2,
          width: wideLayout.paneResizeHandleWidth, zIndex: 1,
          cursor: 'col-resize', touchAction: 'none', userSelect: 'none',
          backgroundColor: active || hovered ? c.interactionOverlay : undefined,
        }}
      />
    </div>
  );
}
