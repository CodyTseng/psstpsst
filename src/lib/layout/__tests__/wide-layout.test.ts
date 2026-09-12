import { clampDesktopPrimaryPaneWidth, getPrimaryPaneWidth, isWideLayoutSize } from '../wide-layout';

describe('wide layout', () => {
  it('requires both window axes on mobile layouts', () => {
    expect(isWideLayoutSize(599, 1024)).toBe(false);
    expect(isWideLayoutSize(600, 600)).toBe(true);
    expect(isWideLayoutSize(932, 430)).toBe(false);
  });

  it('keeps desktop layouts in two panes while only the height shrinks', () => {
    expect(isWideLayoutSize(800, 480, true)).toBe(true);
    expect(isWideLayoutSize(600, 480, true)).toBe(true);
    expect(isWideLayoutSize(599, 1024, true)).toBe(false);
  });

  it('keeps touch primary panes within their responsive bounds', () => {
    expect(getPrimaryPaneWidth(600, false)).toBe(280);
    expect(getPrimaryPaneWidth(1024, false)).toBe(410);
    expect(getPrimaryPaneWidth(1400, false)).toBe(420);
  });

  it('uses a fixed narrower primary pane on desktop', () => {
    expect(getPrimaryPaneWidth(600, true)).toBe(320);
    expect(getPrimaryPaneWidth(960, true)).toBe(320);
    expect(getPrimaryPaneWidth(1400, true)).toBe(320);
  });
});

describe('desktop pane resizing', () => {
  it('bounds the primary pane and reserves room for detail at the split threshold', () => {
    expect(clampDesktopPrimaryPaneWidth(600, 100)).toBe(280);
    expect(clampDesktopPrimaryPaneWidth(600, 480)).toBe(320);
    expect(clampDesktopPrimaryPaneWidth(700, 480)).toBe(420);
    expect(clampDesktopPrimaryPaneWidth(1400, 900)).toBe(900);
    expect(clampDesktopPrimaryPaneWidth(1400, 1400)).toBe(1120);
  });

  it('restores the requested width when the window grows again', () => {
    const preferred = 460;
    expect(clampDesktopPrimaryPaneWidth(600, preferred)).toBe(320);
    expect(clampDesktopPrimaryPaneWidth(1000, preferred)).toBe(preferred);
  });

  it('rounds pointer coordinates and rejects nonfinite values', () => {
    expect(clampDesktopPrimaryPaneWidth(1000, 351.6)).toBe(352);
    expect(clampDesktopPrimaryPaneWidth(1000, NaN)).toBe(320);
    expect(clampDesktopPrimaryPaneWidth(1000, Infinity)).toBe(320);
  });
});
