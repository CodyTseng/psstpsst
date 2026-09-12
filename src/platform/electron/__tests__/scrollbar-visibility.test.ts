/** @jest-environment jsdom */

import { installElectronScrollbarVisibility } from '../scrollbar-visibility';

describe('Electron scrollbar visibility', () => {
  it('ignores programmatic scrolls that no user input armed', () => {
    jest.useFakeTimers();
    const scroller = document.createElement('div');
    Object.defineProperties(scroller, {
      clientHeight: { value: 100 },
      clientWidth: { value: 100 },
      scrollHeight: { value: 400 },
      scrollWidth: { value: 400 },
      scrollTop: { value: 100 },
      scrollLeft: { value: 100 },
    });
    document.body.appendChild(scroller);

    installElectronScrollbarVisibility();
    // A layout-driven jump (e.g. the media pager opening on its focus page)
    // fires scroll events without any preceding wheel/touch input.
    scroller.dispatchEvent(new Event('scroll'));

    expect(document.querySelector('[data-psstpsst-scrollbar-thumb="vertical"]')).toBeNull();
    expect(document.querySelector('[data-psstpsst-scrollbar-thumb="horizontal"]')).toBeNull();

    jest.useRealTimers();
  });

  it('positions an overlay thumb without changing the scroll container', () => {
    jest.useFakeTimers();
    const scroller = document.createElement('div');
    Object.defineProperties(scroller, {
      clientHeight: { value: 100 },
      clientWidth: { value: 100 },
      scrollHeight: { value: 400 },
      scrollWidth: { value: 100 },
      scrollTop: { value: 100 },
    });
    jest.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({
      top: 10,
      right: 120,
      bottom: 110,
      left: 20,
      width: 100,
      height: 100,
      x: 20,
      y: 10,
      toJSON: () => ({}),
    });
    document.body.appendChild(scroller);

    installElectronScrollbarVisibility();
    // A real user scroll is preceded by a wheel/touch input; arm the thumbs.
    scroller.dispatchEvent(new Event('wheel'));
    scroller.dispatchEvent(new Event('scroll'));

    const vertical = document.querySelector<HTMLElement>(
      '[data-psstpsst-scrollbar-thumb="vertical"]',
    );
    const horizontal = document.querySelector<HTMLElement>(
      '[data-psstpsst-scrollbar-thumb="horizontal"]',
    );
    expect(vertical).not.toBeNull();
    expect(vertical?.classList.contains('psstpsst-scroll-active')).toBe(true);
    expect(vertical?.style.top).toBe('36px');
    expect(vertical?.style.left).toBe('114px');
    expect(vertical?.style.width).toBe('4px');
    expect(vertical?.style.height).toBe('24px');
    expect(horizontal?.classList.contains('psstpsst-scroll-active')).toBe(false);
    expect(scroller.className).toBe('');

    const invertedScroller = document.createElement('div');
    // Chromium resolves React Native Web's scaleY(-1) to this computed matrix.
    invertedScroller.style.transform = 'matrix(1, 0, 0, -1, 0, 0)';
    Object.defineProperties(invertedScroller, {
      clientHeight: { value: 100 },
      clientWidth: { value: 100 },
      scrollHeight: { value: 400 },
      scrollWidth: { value: 100 },
      scrollTop: { value: 0 },
    });
    jest.spyOn(invertedScroller, 'getBoundingClientRect').mockReturnValue({
      top: -10,
      right: 220,
      bottom: 110,
      left: 120,
      width: 100,
      height: 120,
      x: 120,
      y: -10,
      toJSON: () => ({}),
    });
    const topChrome = document.createElement('div');
    const bottomChrome = document.createElement('div');
    const unmarkedNavigationLayer = document.createElement('div');
    topChrome.dataset.psstpsstScrollbarOcclusion = 'top';
    bottomChrome.dataset.psstpsstScrollbarOcclusion = 'bottom';
    jest.spyOn(topChrome, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      right: 220,
      bottom: 20,
      left: 120,
      width: 100,
      height: 20,
      x: 120,
      y: 0,
      toJSON: () => ({}),
    });
    jest.spyOn(bottomChrome, 'getBoundingClientRect').mockReturnValue({
      top: 90,
      right: 220,
      bottom: 110,
      left: 120,
      width: 100,
      height: 20,
      x: 120,
      y: 90,
      toJSON: () => ({}),
    });
    jest.spyOn(unmarkedNavigationLayer, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      right: 220,
      bottom: 110,
      left: 120,
      width: 100,
      height: 110,
      x: 120,
      y: 0,
      toJSON: () => ({}),
    });
    document.body.append(topChrome, bottomChrome, unmarkedNavigationLayer);
    document.body.appendChild(invertedScroller);
    invertedScroller.dispatchEvent(new Event('wheel'));
    invertedScroller.dispatchEvent(new Event('scroll'));

    // An inverted list's scrollTop=0 is visually at its bottom. Overlapping
    // chrome keeps the thumb below the header and above the bottom bar without
    // the list declaring either height.
    expect(vertical?.style.top).toBe('64px');

    jest.advanceTimersByTime(300);
    invertedScroller.dispatchEvent(new Event('wheel'));
    invertedScroller.dispatchEvent(new Event('scroll'));
    jest.advanceTimersByTime(499);
    expect(vertical?.classList.contains('psstpsst-scroll-active')).toBe(true);

    jest.advanceTimersByTime(1);
    expect(vertical?.classList.contains('psstpsst-scroll-active')).toBe(false);

    jest.useRealTimers();
  });
});
