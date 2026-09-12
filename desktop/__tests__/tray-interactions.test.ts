import { configureTrayInteractions } from '../tray-interactions';

type EventName = 'click' | 'right-click';

function createTray() {
  const listeners = new Map<EventName, () => void>();
  return {
    listeners,
    on: jest.fn((event: EventName, listener: () => void) => {
      listeners.set(event, listener);
    }),
    setContextMenu: jest.fn(),
    popUpContextMenu: jest.fn(),
  };
}

describe('Electron tray interactions', () => {
  it.each(['darwin', 'win32'] as const)(
    'separates primary activation and the context menu on %s',
    (platform) => {
      const tray = createTray();
      const menu = { id: 'tray-menu' };
      const showMainWindow = jest.fn();
      configureTrayInteractions(tray, menu, showMainWindow, platform);

      tray.listeners.get('click')?.();
      expect(showMainWindow).toHaveBeenCalledTimes(1);
      expect(tray.popUpContextMenu).not.toHaveBeenCalled();

      tray.listeners.get('right-click')?.();
      expect(showMainWindow).toHaveBeenCalledTimes(1);
      expect(tray.popUpContextMenu).toHaveBeenCalledWith(menu);
      expect(tray.setContextMenu).not.toHaveBeenCalled();
    },
  );

  it('keeps the host-managed context menu on Linux', () => {
    const tray = createTray();
    const menu = { id: 'tray-menu' };
    const showMainWindow = jest.fn();
    configureTrayInteractions(tray, menu, showMainWindow, 'linux');

    expect(tray.setContextMenu).toHaveBeenCalledWith(menu);
    expect(tray.listeners.has('right-click')).toBe(false);
    tray.listeners.get('click')?.();
    expect(showMainWindow).toHaveBeenCalledTimes(1);
  });
});
