import { scheduleBottomSheetInputFocus } from '@/components/common/bottom-sheet-input-focus';

describe('Bottom sheet input focus', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('waits for the frame after modal presentation before focusing', () => {
    const focus = jest.fn();
    const frameCallbacks: FrameRequestCallback[] = [];
    jest.spyOn(global, 'requestAnimationFrame').mockImplementation((callback) => {
      frameCallbacks.push(callback);
      return 7;
    });

    scheduleBottomSheetInputFocus({ current: { focus } });

    expect(focus).not.toHaveBeenCalled();
    frameCallbacks[0]?.(0);
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('focuses an input that attaches before the scheduled frame', () => {
    const focus = jest.fn();
    const inputRef: { current: { focus: () => void } | null } = { current: null };
    const frameCallbacks: FrameRequestCallback[] = [];
    jest.spyOn(global, 'requestAnimationFrame').mockImplementation((callback) => {
      frameCallbacks.push(callback);
      return 8;
    });

    scheduleBottomSheetInputFocus(inputRef);
    inputRef.current = { focus };
    frameCallbacks[0]?.(0);

    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('cancels pending focus when the sheet closes', () => {
    jest.spyOn(global, 'requestAnimationFrame').mockReturnValue(9);
    const cancelFrame = jest.spyOn(global, 'cancelAnimationFrame').mockImplementation(() => {});

    const cancel = scheduleBottomSheetInputFocus({ current: { focus: jest.fn() } });
    cancel();

    expect(cancelFrame).toHaveBeenCalledWith(9);
  });
});
