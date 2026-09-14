import {
  placeDesktopMessageActionMenu,
  placeTouchMessageActionMenu,
  resolveMessageContentViewport,
  resolveMessageOverlayWindowGeometry,
} from '../message-action-menu-placement';

describe('resolveMessageOverlayWindowGeometry', () => {
  it('preserves measureInWindow coordinates for a translucent Modal', () => {
    const rect = {
      x: 24,
      y: 92,
      width: 180,
      height: 72,
      body: {
        offsetX: 0,
        offsetY: 4,
        width: 180,
        height: 52,
      },
    };
    const geometry = resolveMessageOverlayWindowGeometry({
      rect,
      contentTop: 59,
      contentBottom: 754,
    });

    expect(geometry.rect).toBe(rect);
    expect(geometry).toEqual({
      rect,
      bodyRect: { x: 24, y: 96, width: 180, height: 52 },
      contentTop: 59,
      contentBottom: 754,
    });
  });
});

describe('resolveMessageContentViewport', () => {
  it('applies the header inset when the list container starts at the screen top', () => {
    expect(
      resolveMessageContentViewport({
        containerTop: 0,
        containerHeight: 844,
        topInset: 103,
        bottomInset: 90,
      }),
    ).toEqual({ contentTop: 103, contentBottom: 754 });
  });

  it('does not add the header twice when a top notice already offsets the container', () => {
    expect(
      resolveMessageContentViewport({
        containerTop: 151,
        containerHeight: 693,
        topInset: 0,
        bottomInset: 90,
      }),
    ).toEqual({ contentTop: 151, contentBottom: 754 });
  });

  it('uses the measured top-notice bottom as the top occlusion boundary', () => {
    expect(
      resolveMessageContentViewport({
        containerTop: 151,
        containerHeight: 693,
        topInset: 0,
        bottomInset: 90,
        occlusionBottom: 158,
      }),
    ).toEqual({ contentTop: 158, contentBottom: 754 });
  });
});

const touchBase = {
  bubbleTop: 170,
  bubbleBottom: 200,
  contentTop: 158,
  contentBottom: 754,
  safeTop: 59,
  safeBottom: 805,
  pillHeight: 49,
  menuHeight: 250,
  showPill: true,
  gap: 10,
};

describe('placeTouchMessageActionMenu', () => {
  it('places reactions above and the menu below a top message when both gutters fit', () => {
    expect(placeTouchMessageActionMenu(touchBase)).toEqual({
      visibleTop: 170,
      visibleBottom: 200,
      pillTop: 111,
      menuTop: 210,
    });
  });

  it('anchors surfaces to a stale source rect without painting the copy over chrome', () => {
    expect(
      placeTouchMessageActionMenu({
        ...touchBase,
        contentTop: 263,
      }),
    ).toEqual({
      visibleTop: 263,
      visibleBottom: 263,
      pillTop: 111,
      menuTop: 210,
    });
  });

  it('clips a message at the top notice and keeps the surfaces outside it', () => {
    expect(
      placeTouchMessageActionMenu({
        ...touchBase,
        bubbleTop: 140,
      }),
    ).toEqual({
      visibleTop: 158,
      visibleBottom: 200,
      pillTop: 99,
      menuTop: 210,
    });
  });

  it('keeps the pill and menu apart when the source must be clipped', () => {
    expect(
      placeTouchMessageActionMenu({
        ...touchBase,
        bubbleTop: 90,
        bubbleBottom: 700,
      }),
    ).toEqual({
      visibleTop: 158,
      visibleBottom: 545,
      pillTop: 99,
      menuTop: 555,
    });
  });
});

const base = {
  safeLeft: 12,
  safeRight: 988,
  safeTop: 12,
  safeBottom: 708,
  menuWidth: 200,
  menuHeight: 250,
  pillWidth: 190,
  pillHeight: 40,
  showPill: true,
  gap: 10,
  stackedGap: 4,
};

describe('placeDesktopMessageActionMenu', () => {
  it('places the menu below-right of the pointer when room is available', () => {
    expect(
      placeDesktopMessageActionMenu({
        ...base,
        anchor: { x: 400, y: 300 },
      }),
    ).toEqual({
      menuLeft: 410,
      menuTop: 310,
      pillLeft: 410,
      pillTop: 266,
    });
  });

  it('flips the cluster above-left with reactions nearest the source', () => {
    expect(
      placeDesktopMessageActionMenu({
        ...base,
        anchor: { x: 980, y: 700 },
      }),
    ).toEqual({
      menuLeft: 770,
      menuTop: 396,
      pillLeft: 770,
      pillTop: 650,
    });
  });

  it('moves the reaction pill below the menu near the top edge', () => {
    expect(
      placeDesktopMessageActionMenu({
        ...base,
        anchor: { x: 20, y: 20 },
      }),
    ).toEqual({
      menuLeft: 30,
      menuTop: 30,
      pillLeft: 30,
      pillTop: 284,
    });
  });
});
