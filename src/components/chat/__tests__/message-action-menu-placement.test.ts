import {
  placeDesktopMessageActionMenu,
  placeTouchMessageActionMenu,
  resolveMessageContentViewport,
  resolveMessageOverlayWindowGeometry,
} from '../message-action-menu-placement';

describe('resolveMessageOverlayWindowGeometry', () => {
  it('preserves the measured body frame within a wider visual cluster', () => {
    const rect = {
      x: 24,
      y: 92,
      width: 180,
      height: 72,
      body: {
        offsetX: 24,
        offsetY: 4,
        width: 156,
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
      bodyRect: { x: 48, y: 96, width: 156, height: 52 },
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

  it('swaps the menu and reactions when stacking them would clip the message', () => {
    expect(
      placeTouchMessageActionMenu({
        ...touchBase,
        bubbleTop: 420,
        bubbleBottom: 455,
        safeBottom: 710,
        menuHeight: 300,
      }),
    ).toEqual({
      visibleTop: 420,
      visibleBottom: 455,
      pillTop: 465,
      menuTop: 110,
    });
  });

  it('keeps reactions next to a bottom message when both surfaces fit above it', () => {
    expect(
      placeTouchMessageActionMenu({
        ...touchBase,
        bubbleTop: 690,
        bubbleBottom: 725,
      }),
    ).toEqual({
      visibleTop: 690,
      visibleBottom: 725,
      pillTop: 631,
      menuTop: 371,
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

  it('keeps the full menu and reactions separate when the source viewport is stale', () => {
    const input = {
      ...touchBase,
      bubbleTop: 410,
      bubbleBottom: 442,
      contentTop: 500,
      safeBottom: 710,
      menuHeight: 350,
    };
    const placement = placeTouchMessageActionMenu(input);
    expect(placement).toEqual({
      visibleTop: 500,
      visibleBottom: 500,
      pillTop: 301,
      menuTop: 360,
    });
  });

  it('uses the top gutter for the full menu before clipping the bubble', () => {
    const placement = placeTouchMessageActionMenu({
      ...touchBase,
      bubbleTop: 397.33,
      bubbleBottom: 432.38,
      safeTop: 53.9,
      safeBottom: 724.38,
      menuHeight: 353.05,
      menuTopInset: 41.9,
      compactGap: 2,
    });
    expect(placement.visibleTop).toBe(397.33);
    expect(placement.visibleBottom).toBe(432.38);
    expect(placement.menuTop).toBeCloseTo(41.9);
    expect(placement.menuTop + 353.05).toBeLessThan(placement.visibleTop);
    expect(placement.pillTop).toBeCloseTo(442.38);
  });

  it('clips the stationary bubble when neither gutter fits the full menu', () => {
    expect(placeTouchMessageActionMenu({
      ...touchBase,
      bubbleTop: 335,
      bubbleBottom: 385,
      safeBottom: 710,
      menuHeight: 350,
    })).toEqual({
      visibleTop: 335,
      visibleBottom: 350,
      pillTop: 276,
      menuTop: 360,
    });
  });

  it('keeps both controls apart when no preview fits in a short viewport', () => {
    const input = {
      ...touchBase,
      bubbleTop: 175,
      bubbleBottom: 205,
      safeBottom: 368,
    };
    const placement = placeTouchMessageActionMenu(input);
    expect(placement.visibleBottom).toBe(placement.visibleTop);
    expect(placement.pillTop + input.pillHeight + input.gap).toBe(placement.menuTop);
    expect(placement.menuTop + input.menuHeight).toBe(input.safeBottom);
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
        bubbleTop: touchBase.safeTop,
        bubbleBottom: touchBase.safeBottom,
        contentTop: touchBase.safeTop,
        contentBottom: touchBase.safeBottom,
      }),
    ).toEqual({
      visibleTop: 118,
      visibleBottom: 545,
      pillTop: 59,
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
