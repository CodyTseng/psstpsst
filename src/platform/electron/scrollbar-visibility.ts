const ACTIVE_CLASS = 'psstpsst-scroll-active';
const INSTALL_MARKER = 'psstpsstScrollbarVisibility';
const VERTICAL_SELECTOR = '[data-psstpsst-scrollbar-thumb="vertical"]';
const HORIZONTAL_SELECTOR = '[data-psstpsst-scrollbar-thumb="horizontal"]';
const HIDE_DELAY_MS = 500;
const THUMB_THICKNESS_PX = 4;
const EDGE_INSET_PX = 2;
const MIN_THUMB_LENGTH_PX = 24;
const OCCLUSION_ATTRIBUTE = 'data-psstpsst-scrollbar-occlusion';
/** A scroll event counts as user-driven only this soon after a wheel/touch input. */
const USER_SCROLL_INPUT_WINDOW_MS = 200;

type OverlayThumbs = {
  vertical: HTMLDivElement;
  horizontal: HTMLDivElement;
};

type ScrollAxis = 'vertical' | 'horizontal';

const invertedAxes = new WeakMap<Element, Record<ScrollAxis, boolean>>();

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function createThumb(axis: 'vertical' | 'horizontal'): HTMLDivElement {
  const thumb = document.createElement('div');
  thumb.dataset.psstpsstScrollbarThumb = axis;
  thumb.className = `psstpsst-scrollbar-overlay-thumb psstpsst-scrollbar-overlay-thumb--${axis}`;
  thumb.setAttribute('aria-hidden', 'true');
  return thumb;
}

function ensureOverlayThumbs(): OverlayThumbs {
  const existingVertical = document.querySelector<HTMLDivElement>(VERTICAL_SELECTOR);
  const existingHorizontal = document.querySelector<HTMLDivElement>(HORIZONTAL_SELECTOR);
  const vertical = existingVertical ?? createThumb('vertical');
  const horizontal = existingHorizontal ?? createThumb('horizontal');

  if (!existingVertical) document.body.appendChild(vertical);
  if (!existingHorizontal) document.body.appendChild(horizontal);

  return { vertical, horizontal };
}

function setThumbActive(thumb: HTMLDivElement, active: boolean): void {
  thumb.classList.toggle(ACTIVE_CLASS, active);
}

function transformedAxisIsInverted(target: Element, axis: ScrollAxis): boolean {
  const cached = invertedAxes.get(target);
  if (cached) return cached[axis];

  const transform = window.getComputedStyle(target).transform;
  let horizontal = false;
  let vertical = false;

  const matrix3d = transform.match(/^matrix3d\((.+)\)$/);
  const matrix = transform.match(/^matrix\((.+)\)$/);
  if (matrix3d) {
    const values = matrix3d[1].split(',').map(Number);
    horizontal = values[0] < 0;
    vertical = values[5] < 0;
  } else if (matrix) {
    const values = matrix[1].split(',').map(Number);
    horizontal = values[0] < 0;
    vertical = values[3] < 0;
  } else {
    // jsdom and some engines preserve the authored transform instead of
    // resolving it to a matrix. React Native Web uses these exact transforms
    // for inverted VirtualizedLists.
    horizontal = /scaleX\(\s*-1\s*\)/.test(transform);
    vertical = /scaleY\(\s*-1\s*\)/.test(transform);
  }

  const result = { horizontal, vertical };
  invertedAxes.set(target, result);
  return result[axis];
}

function visualScrollProgress(target: Element, axis: ScrollAxis, progress: number): number {
  return transformedAxisIsInverted(target, axis) ? 1 - progress : progress;
}

type ScrollBounds = Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left'>;

/**
 * Find shared chrome painted over one vertical edge of a scroll surface. The
 * horizontal probe makes this pane-local: a tab bar in the primary pane does
 * not shorten a detail-pane scrollbar beside it, and dynamically-sized chrome
 * (such as the composer) needs no duplicated height in React.
 */
function verticalOcclusionBoundary(
  target: Element,
  rect: ScrollBounds,
  edge: 'top' | 'bottom',
): number {
  const probeX = clamp(
    rect.right - EDGE_INSET_PX - THUMB_THICKNESS_PX / 2,
    rect.left,
    rect.right,
  );
  const probeY = edge === 'top' ? rect.top + 0.5 : rect.bottom - 0.5;
  let boundary = edge === 'top' ? rect.top : rect.bottom;

  for (const candidate of document.querySelectorAll(
    `[${OCCLUSION_ATTRIBUTE}="${edge}"]`,
  )) {
    // A malformed marker inside the scroll content or around the whole scroll
    // surface cannot be chrome covering that surface.
    if (
      candidate === target ||
      target.contains(candidate) ||
      candidate.contains(target)
    ) {
      continue;
    }

    const candidateRect = candidate.getBoundingClientRect();
    if (candidateRect.right <= probeX || candidateRect.left > probeX) continue;

    if (
      edge === 'top' &&
      candidateRect.top <= probeY &&
      candidateRect.bottom > probeY &&
      candidateRect.bottom > boundary
    ) {
      boundary = Math.min(rect.bottom, candidateRect.bottom);
    } else if (
      edge === 'bottom' &&
      candidateRect.bottom >= probeY &&
      candidateRect.top < probeY &&
      candidateRect.top < boundary
    ) {
      boundary = Math.max(rect.top, candidateRect.top);
    }
  }

  return boundary;
}

function updateOverlayThumbs(target: Element, thumbs: OverlayThumbs): void {
  const isDocumentScroller = target === document.scrollingElement;
  const rect = isDocumentScroller
    ? {
        top: 0,
        right: window.innerWidth,
        bottom: window.innerHeight,
        left: 0,
      }
    : target.getBoundingClientRect();
  const viewportRect = {
    top: clamp(rect.top, 0, window.innerHeight),
    right: clamp(rect.right, 0, window.innerWidth),
    bottom: clamp(rect.bottom, 0, window.innerHeight),
    left: clamp(rect.left, 0, window.innerWidth),
  };
  const visibleTop = verticalOcclusionBoundary(target, viewportRect, 'top');
  const visibleRight = viewportRect.right;
  const visibleBottom = verticalOcclusionBoundary(target, viewportRect, 'bottom');
  const visibleLeft = viewportRect.left;
  const visibleWidth = Math.max(0, visibleRight - visibleLeft);
  const visibleHeight = Math.max(0, visibleBottom - visibleTop);
  const clientWidth = isDocumentScroller ? window.innerWidth : target.clientWidth;
  const clientHeight = isDocumentScroller ? window.innerHeight : target.clientHeight;

  const hasVerticalOverflow = target.scrollHeight > clientHeight + 1 && visibleHeight > 0;
  if (hasVerticalOverflow) {
    const trackTop = visibleTop + EDGE_INSET_PX;
    const trackHeight = Math.max(0, visibleHeight - EDGE_INSET_PX * 2);
    const thumbHeight = Math.min(
      trackHeight,
      Math.max(MIN_THUMB_LENGTH_PX, trackHeight * (clientHeight / target.scrollHeight)),
    );
    const maximumScroll = Math.max(1, target.scrollHeight - clientHeight);
    const scrollProgress = visualScrollProgress(
      target,
      'vertical',
      clamp(target.scrollTop / maximumScroll, 0, 1),
    );
    const thumbTop = trackTop + (trackHeight - thumbHeight) * scrollProgress;
    const thumbLeft =
      document.documentElement.dir === 'rtl'
        ? visibleLeft + EDGE_INSET_PX
        : visibleRight - EDGE_INSET_PX - THUMB_THICKNESS_PX;

    Object.assign(thumbs.vertical.style, {
      top: `${thumbTop}px`,
      left: `${thumbLeft}px`,
      width: `${THUMB_THICKNESS_PX}px`,
      height: `${thumbHeight}px`,
    });
  }
  setThumbActive(thumbs.vertical, hasVerticalOverflow);

  const hasHorizontalOverflow = target.scrollWidth > clientWidth + 1 && visibleWidth > 0;
  if (hasHorizontalOverflow) {
    const trackLeft = visibleLeft + EDGE_INSET_PX;
    const trackWidth = Math.max(0, visibleWidth - EDGE_INSET_PX * 2);
    const thumbWidth = Math.min(
      trackWidth,
      Math.max(MIN_THUMB_LENGTH_PX, trackWidth * (clientWidth / target.scrollWidth)),
    );
    const maximumScroll = Math.max(1, target.scrollWidth - clientWidth);
    const scrollProgress = visualScrollProgress(
      target,
      'horizontal',
      clamp(Math.abs(target.scrollLeft) / maximumScroll, 0, 1),
    );
    const thumbLeft = trackLeft + (trackWidth - thumbWidth) * scrollProgress;
    const thumbTop = visibleBottom - EDGE_INSET_PX - THUMB_THICKNESS_PX;

    Object.assign(thumbs.horizontal.style, {
      top: `${thumbTop}px`,
      left: `${thumbLeft}px`,
      width: `${thumbWidth}px`,
      height: `${THUMB_THICKNESS_PX}px`,
    });
  }
  setThumbActive(thumbs.horizontal, hasHorizontalOverflow);
}

/**
 * Hide native Electron scrollbars and mirror the active container with one
 * pointer-transparent overlay thumb per axis, without reserving layout space.
 */
export function installElectronScrollbarVisibility(): void {
  const root = document.documentElement;
  if (root.dataset[INSTALL_MARKER] !== undefined) return;
  root.dataset[INSTALL_MARKER] = '';

  let thumbs: OverlayThumbs | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  // Programmatic scrolls (the media pager jumping to its initial page, a chat
  // list re-centering a focused message) fire scroll events just like user
  // scrolls do. The thumbs are scroll *feedback*, so they stay hidden unless a
  // fresh wheel/touch input armed them — otherwise merely opening the pager
  // would flash both scrollbars for half a second.
  let lastUserScrollInputAt = 0;
  const noteUserScrollInput = () => {
    lastUserScrollInputAt = Date.now();
  };
  document.addEventListener('wheel', noteUserScrollInput, { capture: true, passive: true });
  document.addEventListener('touchmove', noteUserScrollInput, { capture: true, passive: true });

  document.addEventListener(
    'scroll',
    (event) => {
      const target =
        event.target instanceof Element ? event.target : document.scrollingElement;
      if (!target) return;
      if (Date.now() - lastUserScrollInputAt > USER_SCROLL_INPUT_WINDOW_MS) return;

      thumbs ??= ensureOverlayThumbs();
      updateOverlayThumbs(target, thumbs);
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (!thumbs) return;
        setThumbActive(thumbs.vertical, false);
        setThumbActive(thumbs.horizontal, false);
        hideTimer = undefined;
      }, HIDE_DELAY_MS);
    },
    { capture: true, passive: true },
  );
}
