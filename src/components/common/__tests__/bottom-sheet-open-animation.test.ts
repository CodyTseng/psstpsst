import { scheduleBottomSheetOpenAnimation } from '@/components/common/bottom-sheet-open-animation';

describe('Bottom sheet open animation scheduling', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('waits for the frame after modal presentation before starting', () => {
    const start = jest.fn();
    const frameCallbacks: FrameRequestCallback[] = [];
    jest.spyOn(global, 'requestAnimationFrame').mockImplementation((callback) => {
      frameCallbacks.push(callback);
      return 17;
    });

    scheduleBottomSheetOpenAnimation(start);

    expect(start).not.toHaveBeenCalled();
    frameCallbacks[0]?.(0);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending entrance before it starts', () => {
    jest.spyOn(global, 'requestAnimationFrame').mockReturnValue(18);
    const cancelFrame = jest.spyOn(global, 'cancelAnimationFrame').mockImplementation(() => {});
    const start = jest.fn();

    const cancel = scheduleBottomSheetOpenAnimation(start);
    cancel();

    expect(cancelFrame).toHaveBeenCalledWith(18);
    expect(start).not.toHaveBeenCalled();
  });
});
