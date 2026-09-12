type TrayInteractionTarget<TMenu> = {
  on(event: 'click' | 'right-click', listener: () => void): unknown;
  setContextMenu(menu: TMenu): void;
  popUpContextMenu(menu: TMenu): void;
};

/**
 * Keep primary activation focused on restoring the app. macOS and Windows
 * expose a distinct secondary-click event, so their context menu is opened
 * explicitly instead of being attached to every activation. Linux tray hosts
 * vary in which gesture counts as activation and require the native context
 * menu registration path.
 */
export function configureTrayInteractions<TMenu>(
  tray: TrayInteractionTarget<TMenu>,
  menu: TMenu,
  showMainWindow: () => void,
  platform: NodeJS.Platform,
): void {
  tray.on('click', showMainWindow);
  if (platform === 'darwin' || platform === 'win32') {
    tray.on('right-click', () => tray.popUpContextMenu(menu));
    return;
  }
  tray.setContextMenu(menu);
}
