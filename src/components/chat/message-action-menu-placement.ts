export type PointerAnchor = { x: number; y: number };

type ContentViewportInput = {
  containerTop: number;
  containerHeight: number;
  topInset: number;
  bottomInset: number;
  occlusionBottom?: number;
};

/** Resolve the visible message viewport from the measured list container. */
export function resolveMessageContentViewport({
  containerTop,
  containerHeight,
  topInset,
  bottomInset,
  occlusionBottom,
}: ContentViewportInput): { contentTop: number; contentBottom: number } {
  return {
    contentTop: Math.max(containerTop + topInset, occlusionBottom ?? -Infinity),
    contentBottom: containerTop + containerHeight - bottomInset,
  };
}

type TouchPlacementInput = {
  bubbleTop: number;
  bubbleBottom: number;
  contentTop: number;
  contentBottom: number;
  safeTop: number;
  safeBottom: number;
  pillHeight: number;
  menuHeight: number;
  showPill: boolean;
  gap: number;
};

export type TouchMessageMenuPlacement = {
  visibleTop: number;
  visibleBottom: number;
  pillTop: number;
  menuTop: number;
};

/** Place touch menu surfaces around the visible slice of the source message. */
export function placeTouchMessageActionMenu({
  bubbleTop,
  bubbleBottom,
  contentTop,
  contentBottom,
  safeTop,
  safeBottom,
  pillHeight,
  menuHeight,
  showPill,
  gap,
}: TouchPlacementInput): TouchMessageMenuPlacement {
  const clipTop = Math.max(safeTop, contentTop);
  const clipBottom = Math.min(safeBottom, contentBottom);
  let bubbleVisibleTop = Math.max(clipTop, bubbleTop);
  let bubbleVisibleBottom = Math.min(clipBottom, bubbleBottom);
  let placementBubbleTop = bubbleVisibleTop;
  let placementBubbleBottom = bubbleVisibleBottom;
  const sourceIntersectsViewport = bubbleVisibleBottom > bubbleVisibleTop;

  // A source message can only be long-pressed while it is visible. If an
  // asynchronously measured viewport does not intersect that source, use the
  // source rect only to anchor the pill/menu. The copy itself stays collapsed at
  // the occlusion edge, so a stale measurement can never paint it over chrome.
  if (!sourceIntersectsViewport) {
    placementBubbleTop = Math.max(safeTop, bubbleTop);
    placementBubbleBottom = Math.min(safeBottom, bubbleBottom);
    const occlusionEdge = bubbleBottom <= clipTop ? clipTop : clipBottom;
    bubbleVisibleTop = occlusionEdge;
    bubbleVisibleBottom = occlusionEdge;
  }

  const needPill = showPill ? pillHeight + gap : 0;
  const needMenu = menuHeight + gap;
  const roomAbove = placementBubbleTop - safeTop;
  const roomBelow = safeBottom - placementBubbleBottom;

  let visibleTop = bubbleVisibleTop;
  let visibleBottom = bubbleVisibleBottom;
  let pillTop: number;
  let menuTop: number;

  if (roomAbove >= needPill && roomBelow >= needMenu) {
    pillTop = placementBubbleTop - needPill;
    menuTop = placementBubbleBottom + gap;
  } else if (roomBelow < needMenu && roomAbove >= needPill + needMenu) {
    pillTop = placementBubbleTop - needPill;
    menuTop = pillTop - needMenu;
  } else if (roomAbove < needPill && roomBelow >= needPill + needMenu) {
    pillTop = placementBubbleBottom + gap;
    menuTop = pillTop + needPill;
  } else if (!sourceIntersectsViewport) {
    pillTop = Math.max(safeTop, placementBubbleTop - needPill);
    menuTop = Math.min(safeBottom - menuHeight, placementBubbleBottom + gap);
  } else {
    visibleTop = Math.max(bubbleVisibleTop, safeTop + needPill);
    visibleBottom = Math.min(bubbleVisibleBottom, safeBottom - needMenu);
    pillTop = visibleTop - needPill;
    menuTop = visibleBottom + gap;
  }

  return { visibleTop, visibleBottom, pillTop, menuTop };
}

type PlacementInput = {
  anchor: PointerAnchor;
  safeLeft: number;
  safeRight: number;
  safeTop: number;
  safeBottom: number;
  menuWidth: number;
  menuHeight: number;
  pillWidth: number;
  pillHeight: number;
  showPill: boolean;
  /** Gap between the pointer and the menu. */
  gap: number;
  /** Tighter gap between the pill and the menu when they stack on the same
   * side — there they read as one cluster, not two separate surfaces. */
  stackedGap: number;
};

export type DesktopMessageMenuPlacement = {
  menuLeft: number;
  menuTop: number;
  pillLeft: number;
  pillTop: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, Math.max(min, max)));
}

function placeNearPointer(
  pointer: number,
  extent: number,
  safeStart: number,
  safeEnd: number,
  gap: number,
): number {
  const afterPointer = pointer + gap;
  if (afterPointer + extent <= safeEnd) return Math.max(safeStart, afterPointer);
  return clamp(pointer - gap - extent, safeStart, safeEnd - extent);
}

/**
 * Place Electron's message action panel beside the context-menu pointer,
 * flipping across either axis when the preferred lower-right position would
 * cross the safe viewport. The reaction pill stays adjacent to that panel.
 */
export function placeDesktopMessageActionMenu({
  anchor,
  safeLeft,
  safeRight,
  safeTop,
  safeBottom,
  menuWidth,
  menuHeight,
  pillWidth,
  pillHeight,
  showPill,
  gap,
  stackedGap,
}: PlacementInput): DesktopMessageMenuPlacement {
  const menuLeft = placeNearPointer(anchor.x, menuWidth, safeLeft, safeRight, gap);
  let menuTop = placeNearPointer(anchor.y, menuHeight, safeTop, safeBottom, gap);
  const pillLeft = clamp(menuLeft, safeLeft, safeRight - pillWidth);

  if (!showPill) return { menuLeft, menuTop, pillLeft, pillTop: menuTop };

  // When the panel flips above a low pointer, flip the whole cluster: menu on
  // top, reactions beneath it and closest to the source message. Moving the
  // panel up by the pill height keeps both surfaces above the pointer instead
  // of overlaying the source merely to reverse their order.
  if (menuTop < anchor.y) {
    const clusterTop = anchor.y - gap - (menuHeight + stackedGap + pillHeight);
    if (clusterTop >= safeTop) {
      menuTop = clusterTop;
      return {
        menuLeft,
        menuTop,
        pillLeft,
        pillTop: menuTop + menuHeight + stackedGap,
      };
    }
  }

  const aboveMenu = menuTop - stackedGap - pillHeight;
  const belowMenu = menuTop + menuHeight + stackedGap;
  const pillTop =
    aboveMenu >= safeTop
      ? aboveMenu
      : belowMenu + pillHeight <= safeBottom
        ? belowMenu
        : clamp(anchor.y - pillHeight / 2, safeTop, safeBottom - pillHeight);

  return { menuLeft, menuTop, pillLeft, pillTop };
}
