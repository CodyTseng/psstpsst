import { ElectronHoverGroup } from '../electron-hover-group';

describe('ElectronHoverGroup', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('stays open when a sibling enters before the source leave arrives', () => {
    const onLeaveAll = jest.fn();
    const group = new ElectronHoverGroup(120, onLeaveAll);

    group.enter('source');
    group.enter('menu');
    group.leave('source');
    jest.advanceTimersByTime(200);

    expect(onLeaveAll).not.toHaveBeenCalled();
  });

  it('cancels the gap timer when the pointer reaches another surface', () => {
    const onLeaveAll = jest.fn();
    const group = new ElectronHoverGroup(120, onLeaveAll);

    group.enter('source');
    group.leave('source');
    jest.advanceTimersByTime(60);
    group.enter('menu');
    jest.advanceTimersByTime(120);

    expect(onLeaveAll).not.toHaveBeenCalled();
  });

  it('closes after every surface has remained outside for the grace period', () => {
    const onLeaveAll = jest.fn();
    const group = new ElectronHoverGroup(120, onLeaveAll);

    group.enter('menu');
    group.leave('menu');
    jest.advanceTimersByTime(119);
    expect(onLeaveAll).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(onLeaveAll).toHaveBeenCalledTimes(1);
  });
});
