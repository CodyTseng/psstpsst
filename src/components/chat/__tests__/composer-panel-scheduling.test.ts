import {
  interpolateComposerPanelToKeyboard,
  scheduleComposerPanelWorkAfterPaint,
} from '../composer-panel-scheduling';

describe('composer panel scheduling', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('runs heavy setup in a macrotask after the next animation frame', () => {
    jest.useFakeTimers();
    const work = jest.fn();
    const frames: FrameRequestCallback[] = [];
    jest.spyOn(global, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return 21;
    });

    scheduleComposerPanelWorkAfterPaint(work);

    expect(work).not.toHaveBeenCalled();
    frames[0]?.(0);
    expect(work).not.toHaveBeenCalled();
    jest.runOnlyPendingTimers();
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('cancels setup before either scheduling stage completes', () => {
    jest.useFakeTimers();
    const work = jest.fn();
    const frames: FrameRequestCallback[] = [];
    const cancelFrame = jest.spyOn(global, 'cancelAnimationFrame').mockImplementation(() => {});
    jest.spyOn(global, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return 22;
    });

    const cancelBeforeFrame = scheduleComposerPanelWorkAfterPaint(work);
    cancelBeforeFrame();
    expect(cancelFrame).toHaveBeenCalledWith(22);

    const cancelAfterFrame = scheduleComposerPanelWorkAfterPaint(work);
    frames[1]?.(0);
    cancelAfterFrame();
    jest.runOnlyPendingTimers();
    expect(work).not.toHaveBeenCalled();
  });

  it('moves directly from the panel height to a taller keyboard without dipping', () => {
    const heights = [
      interpolateComposerPanelToKeyboard(150, 0, 0, 34),
      interpolateComposerPanelToKeyboard(150, 75, 0.25, 34),
      interpolateComposerPanelToKeyboard(150, 150, 0.5, 34),
      interpolateComposerPanelToKeyboard(150, 300, 1, 34),
    ];

    expect(heights).toEqual([150, 187.5, 225, 300]);
  });

  it('moves directly to a shorter keyboard without rebounding', () => {
    const heights = [
      interpolateComposerPanelToKeyboard(150, 0, 0, 34),
      interpolateComposerPanelToKeyboard(150, 25, 0.25, 34),
      interpolateComposerPanelToKeyboard(150, 50, 0.5, 34),
      interpolateComposerPanelToKeyboard(150, 100, 1, 34),
    ];

    expect(heights).toEqual([150, 137.5, 125, 100]);
  });
});
