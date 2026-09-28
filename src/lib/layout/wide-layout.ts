import { IS_ELECTRON } from '@/lib/platform';
import { wideLayout } from '@/theme/layout';

export function isWideLayoutSize(
  width: number,
  height: number,
  isDesktop = IS_ELECTRON,
): boolean {
  return width >= wideLayout.minWidth && (isDesktop || height >= wideLayout.minHeight);
}

export function getPrimaryPaneWidth(width: number, isDesktop = IS_ELECTRON): number {
  // Keep the existing flat token shape so Fast Refresh cannot pair a new
  // calculator with an older nested object. These compatibility reads cover
  // the brief module-update window before every refreshed export is visible.
  const layout = wideLayout as {
    primaryFraction?: number;
    primaryMinWidth?: number;
    primaryMaxWidth?: number;
    primaryDesktopWidth?: number;
    primaryPane?: {
      touch?: { fraction?: number; minWidth?: number; maxWidth?: number };
      desktopWidth?: number;
    };
  };
  if (isDesktop) {
    return layout.primaryDesktopWidth ?? layout.primaryPane?.desktopWidth ?? 320;
  }
  const fraction = layout.primaryFraction ?? layout.primaryPane?.touch?.fraction ?? 0.4;
  const minWidth = layout.primaryMinWidth ?? layout.primaryPane?.touch?.minWidth ?? 280;
  const maxWidth = layout.primaryMaxWidth ?? layout.primaryPane?.touch?.maxWidth ?? 420;
  return Math.min(
    maxWidth,
    Math.max(minWidth, Math.round(width * fraction)),
  );
}

/** Keep both touch panes usable while applying the user's requested width. */
export function clampTouchPrimaryPaneWidth(width: number, requestedWidth: number): number {
  'worklet';
  const maximum = Math.max(
    wideLayout.primaryMinWidth,
    Math.min(wideLayout.primaryMaxWidth, width - wideLayout.detailMinWidth),
  );
  const responsiveDefault = Math.min(
    wideLayout.primaryMaxWidth,
    Math.max(wideLayout.primaryMinWidth, Math.round(width * wideLayout.primaryFraction)),
  );
  const preferred = Number.isFinite(requestedWidth)
    ? requestedWidth
    : responsiveDefault;
  return Math.min(maximum, Math.max(wideLayout.primaryMinWidth, Math.round(preferred)));
}

/** Reserve usable detail space even when the window shrinks during a drag. */
export function clampDesktopPrimaryPaneWidth(width: number, requestedWidth: number): number {
  const maximum = Math.max(
    wideLayout.primaryDesktopMinWidth,
    width - wideLayout.detailDesktopMinWidth,
  );
  const preferred = Number.isFinite(requestedWidth)
    ? requestedWidth
    : wideLayout.primaryDesktopWidth;
  return Math.min(maximum, Math.max(wideLayout.primaryDesktopMinWidth, Math.round(preferred)));
}
